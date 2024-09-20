import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { RequestsService } from './main';
const { exec } = require('child_process');

const delay = promisify(setTimeout);

describe('RequestsService', () => {
  let service: RequestsService;

  const outputDir = './scans';
  const ensureDirectoryExists = (dir: string) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  };

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [RequestsService],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
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

  it('should generate a Lighthouse report and ensure accessibility score is >= 75', async () => {
    const url = process.env.TEST_URL || 'https://github.com/';
    const filePath = path.join(outputDir, `report.report.json`);
    
    const result = await service.buildSummary(url);
    
    const isFileCreated = await checkFileCreated(filePath, 60000);
    expect(isFileCreated).toBe(true);

    if (isFileCreated) {
      const jsonReport = fs.readFileSync(filePath, 'utf8');
      const parsedReport = JSON.parse(jsonReport);

      const accessibilityScore = parsedReport.categories.accessibility.score * 100;

      console.log('===============================');
      console.log('Accessibility Score:', accessibilityScore);
      console.log('===============================');

      expect(accessibilityScore).toBeGreaterThanOrEqual(75);
    }
  }, 90000);
});
