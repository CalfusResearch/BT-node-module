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

  const outputDir = 'src/main/';
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

  it('should generate a Lighthouse report and ensure accessibility score is >= 75', async () => {
    const url = process.env.TEST_URL || 'https://github.com/';
    
    const parentUuid = await service.makeScann(url);
    const filePath = path.join(outputDir, `${parentUuid}-1.report.report.html`);
    
    const isFileCreated = await checkFileCreated(filePath, 600000);
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
  }, 900000);
});
