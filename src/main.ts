import { Logger } from '@nestjs/common';
import * as fs from 'fs';
const { exec } = require('child_process');
import OpenAI from 'openai';



interface AccessibilityIssue {
    issue_title: string;
    issue_description: string;
    snippet: string;
    explanation: string;
  }
  

export class RequestsService {
  private logger: Logger = new Logger(RequestsService.name);

  constructor() {}

  async makeScann(url: string) {
    this.buildSummary(url);
    return { message: 'Scan initiated.' };
  }

  async buildSummary(url: string) {
    const jsonFilePath = `./scans/report.report.json`; 
    const command = `lighthouse ${url} --output=json --output=html --output-path=./scans/report --chrome-flags="--headless" --timeout=60000`;

    this.logger.log('Running Lighthouse audit in headless mode...');

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Error running Lighthouse audit: ${stderr}`);
        return;
      }
      this.logger.log('Lighthouse audit completed. Report saved.');
      this.importJsonReport(jsonFilePath);
    });
  }

  importJsonReport(jsonFilePath: string) {
    fs.readFile(jsonFilePath, 'utf8', (err, data) => {
      if (err) {
        this.logger.error(`Error reading JSON report: ${err.message}`);
        return;
      }
      try {
        const json = JSON.parse(data);
        this.logger.log('Lighthouse JSON report data:', json);
        this.processAuditResults(json);
      } catch (parseError) {
        this.logger.error(`Error parsing JSON report: ${parseError.message}`);
      } finally {
        fs.unlink(jsonFilePath, (deleteErr) => {
          if (deleteErr) {
            this.logger.error(`Error deleting JSON file: ${deleteErr.message}`);
          } else {
            this.logger.log(`JSON report file ${jsonFilePath} deleted successfully.`);
          }
        });
      }
    });
  }

  processAuditResults(json: any) {
    const aiReq: AccessibilityIssue[] = []; 
  
    json?.categories?.accessibility?.auditRefs?.forEach((it) => {
      const status = json?.audits[it.id]?.details?.headings[0]?.label == 'Failing Elements' ? 'Fail' : 'Pass';
      if (status === 'Fail') {
        json?.audits[it.id]?.details?.items?.forEach((itm) => {
            aiReq.push({
            issue_title: json?.audits[it.id]?.title || '',
            issue_description: json?.audits[it.id]?.description || '',
            snippet: itm?.node?.snippet || '',
            explanation: itm?.node?.explanation || '',
          });
        });
      }
    });
  
    if (aiReq.length > 0) {
      this.getAiRecommendations(aiReq);
    }
  }

  async getAiRecommendations(failedAudits: any[]) {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    let prompt =
      'I have extracted multiple accessibility issues from a Google Lighthouse report. They are based on Web Content Accessibility Guidelines (WCAG). Please suggest concise, direct solutions for the following issues without numbering or extra formatting:\n\n';
    failedAudits.forEach((audit) => {
      prompt += `Title: ${audit.issue_title}\nDescription: ${audit.issue_description}\nSnippet: ${audit.snippet}\nExplanation: ${audit.explanation}\n\n`;
    });

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert in web accessibility, providing brief and actionable fixes without numbering or extra formatting.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
      });
      const aiResponse = response?.choices?.[0]?.message?.content?.trim() || '';
      const aiRecommendations = aiResponse.split('\n\n');

      failedAudits.forEach((audit, index) => {
        const recommendation = aiRecommendations[index] || 'No recommendation available';
        this.logger.log(`Recommendation for issue ${audit.issue_title}: ${recommendation}`);
      });
    } catch (error) {
      this.logger.error('Error fetching AI recommendations:', error.message || error);
      throw new Error('Failed to fetch AI recommendations.');
    }
  }
}
