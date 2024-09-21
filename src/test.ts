import { RequestsService } from "./main";

async function main() {
  const requestsService = new RequestsService();

  try {
    const result = await requestsService.makeScann('https://calfus.com');
    console.log('Scan initiated successfully:', result);
  } catch (error) {
    console.error('Error occurred while initiating the scan:', error);
  }
}

main();
