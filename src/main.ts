import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { exec } from 'child_process';
import * as fs from 'fs';
import OpenAI from 'openai';
import { URL } from 'url';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { Groups, GuideLine, Item, Status } from './types';

const visited = new Set();
const allUrls = new Set();
const execPromise = promisify(exec);


interface AccessibilityIssue {
    issue_title: string;
    issue_description: string;
    snippet: string;
    explanation: string;
  }
  
@Injectable()   
export class WebAuditorService {
  private logger: Logger = new Logger(WebAuditorService.name);

  constructor() {}

  async makeScann(url: string, maxDepth: Number = 0, parentUuid: string | null = null, processJson: boolean = true) {
    const queue = [{ url: url, depth: 0 }];
    let allUrls = this.bfsCrawl(queue, url, maxDepth, url)

    if (parentUuid == null){
        parentUuid = uuidv4()
    }
    this.generateReportsForAllUrls(allUrls, parentUuid,processJson)
    return { message: parentUuid };
  }

  async generateReportsForAllUrls(allUrls: any, parentId: string, processJson: boolean = true): Promise<{url: any, index: number}[]> {
    let resolvedUrls = await allUrls;
    const concurrencyLimit = 5;
    const urlsArray = Array.from(resolvedUrls);
    const queue: Promise<void>[] = [];
    const results: {url: any, index: number}[] = [];  
  
    const processBatch = async (url: any, index: any) => {
      await this.bulidSummaryCallback(url, parentId, String(index + 1), undefined, processJson);
      results.push({ url, index });  
    };
  
    for (let index = 0; index < urlsArray.length; index++) {
      const eachUrl = urlsArray[index];
  
      const task = processBatch(eachUrl, index);
      queue.push(task);
  
      if (queue.length >= concurrencyLimit) { 
        await Promise.race(queue);
        queue.splice(queue.findIndex(async p => await p === await Promise.race(queue)), 1);
      }
    }
    
    await Promise.all(queue);
  
    return results; 
  }
  
  // async buildSummary(url: string, parentId: string, numberCount: string) {
  
  //     const directoryName = `src/scans`
  //     if (!fs.existsSync(directoryName)) {
  //       fs.mkdirSync(directoryName, { recursive: true });
  //     }
  
  //     const jsonFilePath = `${directoryName}/${parentId}-${numberCount}.report.json`; 
  //     const htmlFilePath = `${directoryName}/${parentId}-${numberCount}.html`; 
  //     const command = `lighthouse ${url} --output=json --output-path=${jsonFilePath} --output=html --output-path=${htmlFilePath} --chrome-flags="--headless" --timeout=60000`;
  //     this.logger.log('Running Lighthouse audit in headless mode...');
  
  //     try {
  //         await execPromise(command);
  
  //         this.logger.log(`Lighthouse audit completed. Report saved. for id: ${numberCount}`);
          
  //         this.importJsonReport(jsonFilePath,htmlFilePath );
  //     } catch (error: any) {
  //         this.logger.error(`Error running Lighthouse audit: ${error.message}`);
  //     }
  // }

  async bulidSummaryCallback(url: string, parentId: string, numberCount: string,  callBack? :()=>void |undefined, processJson: boolean = true) {
    let accessibilityScore = 100
    const directoryName = `src/scans`
    if (!fs.existsSync(directoryName)) {
      fs.mkdirSync(directoryName, { recursive: true });
    }

    let jsonFilePath = `${directoryName}/${parentId}-${numberCount}.json`; 
    let htmlFilePath = `${directoryName}/${parentId}-${numberCount}.html`; 

    const command = `lighthouse ${url} --output=json --output=html --output-path=${jsonFilePath.replace('.json', '')} --chrome-flags="--headless" --timeout=60000`;
    this.logger.log('Running Lighthouse audit in headless mode...');
    exec(command, async (error, stdout, stderr) => {
        if (error) {
            this.logger.log(`Lighthouse audit completed. Report saved. for id: ${numberCount}`);
            this.logger.error(`Error running Lighthouse audit: ${error.message}`);
            return;
        }
        this.logger.log(`Lighthouse audit completed. Report saved. for id: ${numberCount}`);

        jsonFilePath = jsonFilePath.replace('.json','.report.json')
        htmlFilePath = htmlFilePath.replace('.html','.report.html')

        const fileContent = await fs.promises.readFile(jsonFilePath, 'utf-8'); 
        const parsedReport = JSON.parse(fileContent);
        accessibilityScore = parsedReport.categories.accessibility.score * 100;  
        

        if(processJson){
          this.importJsonReport(jsonFilePath, htmlFilePath, callBack) 
        }
      })

      return accessibilityScore
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

  importJsonReport(jsonFilePath: string,htmlFilePath: string, callBack? :()=>void |undefined ) {
    fs.readFile(jsonFilePath, 'utf8', (err, data) => {
      if (err) {
          this.logger.error('Error reading the file:', err);
          return;
      }
    
      this.logger.log('Updating Results .. ')
      const processedData: any = JSON.stringify(this.formatJson(JSON.parse(data), htmlFilePath ));
      jsonFilePath = jsonFilePath.replace('.report.json','.json')
      fs.writeFile(jsonFilePath, processedData, (err) => {
          if (err) {
              this.logger.error('Error writing the file:', err);
              return;
          }
          this.logger.log('Processed content saved successfully to', jsonFilePath);
          if(callBack) {
            this.logger.log('Calling callback ...')
            callBack()
        }
      });
    });
  }


  formatJson(json:any, htmlFilePath) {
    const groups = new Map<string, Groups>()
    json?.categories?.accessibility.auditRefs?.forEach(it => {
        const grp : Groups = {
          title: json?.categoryGroups[it.group]?.title ?? 'default',
          description: json?.categoryGroups[it.group]?.description ?? "default",
          guidLine: []
        }
        groups.set(it.group ?? 'default', grp)
    });

    json?.categories?.accessibility.auditRefs?.forEach(it => {
      const grp = groups.get(it.group ?? 'default') 
      if(grp) {
        const status = json?.audits[it.id]?.details?.headings[0]?.label == 'Failing Elements' ? Status.Fail : Status.Pass;
        const guildeLine: GuideLine = {
            description:  json?.audits[it.id]?.description || "",
            score: json?.audits[it.id]?.score || 0,
            status: status,
            type: it.id,
            title: json?.audits[it.id]?.description ||  "",
            weight: json?.audits[it.id]?.weight || 0,
            item: []
        }
        if(status === Status.Fail) {
            json?.audits[it.id]?.details?.items?.forEach(itm=> {
              const item : Item = {
                explanation: itm?.node?.explanation,
                snippet: itm?.node?.snippet,
              }
              guildeLine.item.push(item)
            })
        }
        grp.guidLine.push(guildeLine)
        groups.set(it.group ?? 'default', grp)
      }
    });
    const accessabilty: Groups[] = []
    groups.forEach(it=> accessabilty.push(it))

  //   const htmlData = this.convertJSONToHTML(accessabilty)

  //   fs.writeFile(htmlFilePath, htmlData, (err) => {
  //     if (err) {
  //         console.error('Error writing file:', err);
  //     } else {
  //         console.log('File saved successfully!');
  //     }
  // });
  
    return accessabilty
  }

  convertJSONToHTML(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return "<p>No data available</p>";
    }

    const headers = Object.keys(this.flattenObject(data[0]));  // Get table headers
    let html = `
        <html>
        <head>
            <style>
                table {
                    border-collapse: collapse;
                    width: 100%;
                    margin: 20px 0;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f2f2f2;
                    font-weight: bold;
                }
                tr:hover {
                    background-color: #f5f5f5;
                }
            </style>
        </head>
        <body>
            <table>
                <thead>
                    <tr>
                        ${headers.map(header => `<th>${header.replace(/\./g, ' ')}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach(row => {
        const flatRow = this.flattenObject(row);  // Flatten the current row
        html += "<tr>";
        headers.forEach(header => {
            html += `<td>${flatRow[header] !== undefined ? flatRow[header] : ''}</td>`;
        });
        html += "</tr>";
    });
    
    html += `
                </tbody>
            </table>
        </body>
        </html>
    `;
    return html;
}

flattenObject(obj) {
    const result = {};
    for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            const flatObj = this.flattenObject(obj[key]);
            for (const flatKey in flatObj) {
                result[`${key}.${flatKey}`] = flatObj[flatKey]; // Prefix with parent key
            }
        } else {
            result[key] = obj[key];
        }
    }
    return result;
}


  processAuditResults(json: any) {
    const aiReq: AccessibilityIssue[] = []; 
  
    json?.categories?.accessibility?.auditRefs?.forEach((it: any) => {
      const status = json?.audits[it.id]?.details?.headings[0]?.label == 'Failing Elements' ? 'Fail' : 'Pass';
      if (status === 'Fail') {
        json?.audits[it.id]?.details?.items?.forEach((itm: any) => {
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
    } catch (error: any) {
      this.logger.error('Error fetching AI recommendations:', error.message || error);
      throw new Error('Failed to fetch AI recommendations.');
    }
  }


  async getLinksFromPage(url: any, rootUrl: any) {
    try {
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);
        const links = new Set();

        $('a[href]').each((_: any, element: any) => {
            let href:any = $(element).attr('href');
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
    } catch (error: any) {
        console.error(`Error accessing ${url}:`, error.message);
        return new Set();
    }
}

async processUrl(queue: { url: unknown; depth: any; }[], currentUrl: any, depth: number, maxDepth: number, rootUrl: any) {
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

async bfsCrawl(queue: any, startUrl: unknown, maxDepth: any, rootUrl: string) {
    visited.add(startUrl);
    allUrls.add(startUrl);

    while (queue.length > 0) {
        const { url, depth } = queue.shift();
        await this.processUrl(queue, url, depth, maxDepth,rootUrl);
    }

    return allUrls
}


}
