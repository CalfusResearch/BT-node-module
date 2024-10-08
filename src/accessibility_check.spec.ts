import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { WebAuditorService } from './main';
const { exec } = require('child_process');
import { v4 as uuidv4 } from 'uuid';

const delay = promisify(setTimeout);

describe('WebAuditorService', () => {
  let service: WebAuditorService;

  const outputDir = 'src/scans/';
  const ensureDirectoryExists = (dir: string) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  };

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebAuditorService],
    }).compile();

    service = module.get<WebAuditorService>(WebAuditorService);
    ensureDirectoryExists(outputDir);
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  const checkFileCreated = async (filePath: string, timeout = 60000, interval = 1000) => {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      if (fs.existsSync(filePath)) {
        return true;
      }
      await delay(interval);
    }
    return false;
  };
  
  const testTimeout = Number(process.env.TEST_TIMEOUT) || 90000;

  it('should generate Lighthouse reports and ensure all accessibility scores are greater than the set threshold', async () => {
    const url = process.env.TEST_URL || 'https://calfus.com/';
    const maxDepth = Number(process.env.MAX_DEPTH) || 0;
    const checkForAccessibility = Number(process.env.ACCESSIBILITY_CHECK_LIMIT) || 0;
    const waitTimeout = Number(process.env.WAIT_TIMEOUT) || 45000;
    const parentUuid = uuidv4();
    const response = await service.makeScann(url, Number(maxDepth), parentUuid, false);
    
    console.log('==========', parentUuid)
    await new Promise(resolve => setTimeout(resolve, waitTimeout));
  
    const jsonFiles = fs.readdirSync(outputDir).filter(file => file.startsWith(`${parentUuid}`) && file.endsWith('.json'));
  
    if (jsonFiles.length === 0) {
      throw new Error(`No Lighthouse reports found in ${outputDir} for parent UUID ${parentUuid}. Ensure the scan completed successfully.`);
    }
  
    let allScoresValid = true;
    let failedFile = '';
    let failedScore = 0;
  
    for (const file of jsonFiles) {
      const filePath = path.join(outputDir, file);
      const jsonReport = fs.readFileSync(filePath, 'utf8');
      const parsedReport = JSON.parse(jsonReport);
      const accessibilityScore = parsedReport.categories.accessibility.score * 100;
  
      console.log(`Accessibility Score for ${file}:`, accessibilityScore);
  
      if (accessibilityScore < checkForAccessibility) {
        allScoresValid = false;
        failedFile = file;
        failedScore = accessibilityScore;
        break;
      }
    }
  
    if (!allScoresValid) {
      throw new Error(`Accessibility score for ${failedFile} is ${failedScore}, which is below the threshold of ${checkForAccessibility}.`);
    }
  
    expect(allScoresValid).toBe(true);
  }, testTimeout);
  
  
});
