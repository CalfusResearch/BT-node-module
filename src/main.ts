import { Logger } from '@nestjs/common';
import { root } from 'cheerio/dist/commonjs/static';
import * as fs from 'fs';
const { exec } = require('child_process');
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const visited = new Set();
const allUrls = new Set();

const util = require('util');
const execPromise = util.promisify(exec);


interface AccessibilityIssue {
    issue_title: string;
    issue_description: string;
    snippet: string;
    explanation: string;
  }
  

export class RequestsService {
  private logger: Logger = new Logger(RequestsService.name);

  constructor() {}

  async makeScann(url: string, maxDepth: Number = 1) {
    const queue = [{ url: url, depth: 0 }];
    let allUrls = this.bfsCrawl(queue, url, maxDepth, url)

    const parentId = uuidv4()
    this.generateReportsForAllUrls(allUrls, parentId)

    return { message: parentId };
  }

  async generateReportsForAllUrls(allUrls: any, parentId: string) {
    let resolvedUrls = await allUrls
    const concurrencyLimit = 5; 
    const urlsArray = Array.from(resolvedUrls);
    const queue = []; 
  
    const processBatch = async (url: any, index: number) => {
      await this.buildSummary(url, parentId, String(index + 1));
    };
  
    for (let index = 0; index < urlsArray.length; index++) {
      const eachUrl = urlsArray[index];
  
      const task = processBatch(eachUrl, index);
      queue.push(task);
  
      if (queue.length >= concurrencyLimit) {
        await Promise.race(queue); 
        queue.splice(queue.indexOf(await Promise.race(queue)), 1);
      }
    }
  
    await Promise.all(queue);
  }

  
  async buildSummary(url: string, parentId: string, numberCount: string) {
  
      const directoryName = `src/scans`
      if (!fs.existsSync(directoryName)) {
        fs.mkdirSync(directoryName, { recursive: true });
      }
  
      const jsonFilePath = `${directoryName}/${parentId}-${numberCount}.report.json`; 
      const htmlFilePath = `${directoryName}/${parentId}-${numberCount}.report.html`;
  
      const command = `lighthouse ${url} --output=json --output=html --output-path=${jsonFilePath.replace('.json', '')} --chrome-flags="--headless" --timeout=60000`;
      this.logger.log('Running Lighthouse audit in headless mode...');
  
      try {
          await execPromise(command);
  
          // await this.checkFileExists(jsonFilePath);
          // await this.checkFileExists(htmlFilePath);
  
          this.logger.log(`Lighthouse audit completed. Report saved. for id: ${numberCount}`);
          
          this.importJsonReport(jsonFilePath);
      } catch (error) {
          this.logger.error(`Error running Lighthouse audit: ${error.message}`);
      }
  }
  
  async checkFileExists(filePath: string) {
      return new Promise((resolve, reject) => {
          const interval = setInterval(() => {
              if (fs.existsSync(filePath)) {
                  clearInterval(interval);
                  resolve(true);
              }
          }, 100); 
  
          setTimeout(() => {
              clearInterval(interval);
              reject(new Error(`Timeout waiting for file: ${filePath}`));
          }, 60000); 
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
        // fs.unlink(jsonFilePath, (deleteErr) => {
        //   if (deleteErr) {
        //     this.logger.error(`Error deleting JSON file: ${deleteErr.message}`);
        //   } else {
        //     this.logger.log(`JSON report file ${jsonFilePath} deleted successfully.`);
        //   }
        // });
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
  
    // if (aiReq.length > 0) {
    //   this.getAiRecommendations(aiReq);
    // }
  }

  async getAiRecommendations(failedAudits: any[]) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        this.logger.warn('OpenAI API Key is missing. Skipping AI recommendations.');
        return;  
    }
    const openai = new OpenAI({
      apiKey: apiKey
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


  async getLinksFromPage(url, rootUrl) {
    try {
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);
        const links = new Set();

        $('a[href]').each((_, element) => {
            let href = $(element).attr('href');
            const fullUrl = new URL(href, url).href;
            const linkUrl = new URL(fullUrl);

            if (
              linkUrl.hostname.includes(new URL(rootUrl).hostname) && 
              !linkUrl.hash &&
                !fullUrl.endsWith('.pdf') &&
                !fullUrl.endsWith('.jpg') &&
                !fullUrl.endsWith('.png') &&
                !fullUrl.endsWith('.css') &&
                !fullUrl.endsWith('.js') &&
                !href.startsWith('#') &&
                !fullUrl.includes('?')
            ) {
                links.add(fullUrl);
            }
        });
        return links;
    } catch (error) {
        console.error(`Error accessing ${url}:`, error.message);
        return new Set();
    }
}

async processUrl(queue, currentUrl, depth, maxDepth, rootUrl) {
    if (depth >= maxDepth) return;

    console.log(`Processing URL: ${currentUrl} at depth ${depth}`);

    const links = await this.getLinksFromPage(currentUrl, rootUrl);

    links.forEach((link) => {
        if (!visited.has(link)) {
            console.log(`  Found new link: ${link} at depth ${depth + 1}`);
            visited.add(link);
            queue.push({ url: link, depth: depth + 1 });
            allUrls.add(link);
        }
    });
}

async bfsCrawl(queue, startUrl, maxDepth, rootUrl) {
    visited.add(startUrl);
    allUrls.add(startUrl);

    while (queue.length > 0) {
        const { url, depth } = queue.shift();
        await this.processUrl(queue, url, depth, maxDepth,rootUrl);
    }

    return allUrls
}


}
