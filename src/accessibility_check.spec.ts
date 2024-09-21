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

  it('should generate Lighthouse reports and ensure all accessibility scores are >= 75', async () => {
    const url = process.env.TEST_URL || 'https://calfus.com/';
    const maxDepth = process.env.MAX_DEPTH || 0;
    const parentUuid = uuidv4();
    const response = service.makeScann(url, Number(maxDepth), parentUuid, false);
    
    await new Promise(resolve => setTimeout(resolve, 45000));
  
    const jsonFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.json'));
  
    expect(jsonFiles.length).toBeGreaterThan(0);
  
    let allScoresValid = true;
  
    for (const file of jsonFiles) {
      const filePath = path.join(outputDir, file);
      const jsonReport = fs.readFileSync(filePath, 'utf8');
      const parsedReport = JSON.parse(jsonReport);
      const accessibilityScore = parsedReport.categories.accessibility.score * 100;
  
      console.log(`Accessibility Score for ${file}:`, accessibilityScore);
  
      if (accessibilityScore < 75) {
        allScoresValid = false;
        break;
      }
    }
  
    expect(allScoresValid).toBe(true);
  }, 90000);

});
