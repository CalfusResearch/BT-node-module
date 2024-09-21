import { WebAuditorService } from "./main";

async function main() {
  const webAuditorService = new WebAuditorService();

  try {
    const result = await WebAuditorService.makeScann('https://calfus.com');
    console.log('Scan initiated successfully:', result);
  } catch (error) {
    console.error('Error occurred while initiating the scan:', error);
  }
}

main();
