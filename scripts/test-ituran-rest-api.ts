/**
 * Ituran REST API Test Script
 *
 * Tests the WCF/REST service at web2.ituran.com.ar for the TripsData endpoint.
 * Discovered that despite the URL suggesting REST, the service is a WCF service
 * that exposes BOTH a SOAP 1.2 (Mex) binding AND a webHttpBinding (REST/JSON).
 *
 * KEY FINDINGS:
 * - The REST endpoint works via POST with JSON body
 * - Credentials go IN the JSON body (not in headers or basic auth)
 * - GET requests return 404 (not supported)
 * - SOAP 1.1 and 1.2 endpoints return 404 (only Mex binding exposed for metadata)
 * - The URL provided by Ituran uses "Vehicule" but the actual WSDL uses "Vehicle"
 *   Both spellings appear to work for the REST endpoint
 *
 * Usage: npx ts-node scripts/test-ituran-rest-api.ts
 */

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = 'https://web2.ituran.com.ar/ibi2_services/tripsData.svc';
const ENDPOINT = `${BASE_URL}/GetTripsByDateDriverNVehicleNTripID`;
const ENDPOINT_TYPO = `${BASE_URL}/GetTripsByDateDriverNVehiculeNTripID`; // original URL from Ituran

const CREDENTIALS = {
  userName: 'GARYCIO_API',
  password: 'Ituran2025',
};

const TEST_DATA_DIR = path.join(__dirname, '..', 'test-data');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TripDataDTO {
  readonly carNum: string;
  readonly driveGrade: number;
  readonly driveNumerator: number;
  readonly driverCode: number;
  readonly endDriveAddress: string;
  readonly endDriveDate: string;
  readonly endDriveKm: number;
  readonly endDriveTime: string;
  readonly fastestDriveSpeed: number;
  readonly isNightDrive: boolean;
  readonly originalTripId: number;
  readonly startDriveAddress: string;
  readonly startDriveDate: string;
  readonly startDriveKm: number;
  readonly startDriveTime: string;
  readonly totalDriveKm: number;
  readonly totalDriveTime: string;
  readonly totalStandTime: string;
}

interface GetTripsRequest {
  readonly userName: string;
  readonly password: string;
  readonly plates: string;
  readonly driverIds: string;
  readonly fromTripId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly resultSize: string;
}

interface ErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

interface TestResult {
  readonly name: string;
  readonly method: string;
  readonly url: string;
  readonly statusCode: number;
  readonly success: boolean;
  readonly responseType: string;
  readonly dataCount?: number;
  readonly error?: string;
  readonly responsePreview: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(
  url: string,
  options: {
    readonly method: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly auth?: string;
  },
): Promise<{ readonly statusCode: number; readonly body: string; readonly headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const reqOptions: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method,
      headers: {
        ...options.headers,
      },
    };

    if (options.auth) {
      reqOptions.auth = options.auth;
    }

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value;
          }
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          body,
          headers: responseHeaders,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout (15s)'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test functions
// ---------------------------------------------------------------------------

function getYesterdayAndToday(): { readonly fromDate: string; readonly toDate: string } {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return { fromDate: fmt(yesterday), toDate: fmt(today) };
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

async function testGetServiceRoot(): Promise<TestResult> {
  const name = '1. GET service root';
  try {
    const res = await httpRequest(BASE_URL, { method: 'GET' });
    const isServicePage = res.body.includes('TripsData Service');
    return {
      name,
      method: 'GET',
      url: BASE_URL,
      statusCode: res.statusCode,
      success: res.statusCode === 200,
      responseType: isServicePage ? 'WCF Service Info Page (HTML)' : 'Other',
      responsePreview: isServicePage
        ? '[WCF service page - lists svcutil.exe usage and C#/VB examples]'
        : truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'GET',
      url: BASE_URL,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testGetEndpoint(): Promise<TestResult> {
  const name = '2. GET endpoint (REST-style)';
  try {
    const { fromDate, toDate } = getYesterdayAndToday();
    const params = new URLSearchParams({
      userName: CREDENTIALS.userName,
      password: CREDENTIALS.password,
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '5',
    });
    const url = `${ENDPOINT}?${params}`;
    const res = await httpRequest(url, { method: 'GET' });
    return {
      name,
      method: 'GET',
      url: ENDPOINT + '?...',
      statusCode: res.statusCode,
      success: false,
      responseType: res.statusCode === 404 ? 'Endpoint not found (GET not supported)' : 'Unexpected',
      responsePreview: truncate(res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 200),
    };
  } catch (err) {
    return {
      name,
      method: 'GET',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testPostJsonWithCredentials(): Promise<TestResult> {
  const name = '3. POST JSON with credentials in body (WORKING METHOD)';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body: GetTripsRequest = {
      ...CREDENTIALS,
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '10',
    };

    const res = await httpRequest(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let dataCount: number | undefined;
    let responseType = 'Unknown';
    let responsePreview = truncate(res.body, 300);

    try {
      const parsed = JSON.parse(res.body);
      if (Array.isArray(parsed)) {
        dataCount = parsed.length;
        responseType = `JSON Array of TripDataDTO (${dataCount} trips)`;
        if (parsed.length > 0) {
          responsePreview = JSON.stringify(parsed[0], null, 2);
        }
      } else if (parsed.code) {
        responseType = `Error: ${parsed.code} - ${parsed.message}`;
      }
    } catch {
      responseType = 'Non-JSON response';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: res.statusCode,
      success: res.statusCode === 200,
      responseType,
      dataCount,
      responsePreview,
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testPostJsonWithBasicAuth(): Promise<TestResult> {
  const name = '4. POST JSON with Basic Auth header (no body creds)';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body = {
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '5',
    };

    const res = await httpRequest(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      auth: `${CREDENTIALS.userName}:${CREDENTIALS.password}`,
    });

    let responseType = 'Unknown';
    try {
      const parsed = JSON.parse(res.body);
      if (parsed.code) {
        responseType = `Error: ${parsed.code} - ${parsed.message}`;
      } else if (Array.isArray(parsed)) {
        responseType = `JSON Array (${parsed.length} items)`;
      }
    } catch {
      responseType = 'Non-JSON';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: res.statusCode,
      success: false,
      responseType,
      responsePreview: truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testPostFilterByPlate(): Promise<TestResult> {
  const name = '5. POST JSON filtered by plate number';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body: GetTripsRequest = {
      ...CREDENTIALS,
      plates: 'HPS263',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '50',
    };

    const res = await httpRequest(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let dataCount: number | undefined;
    let responseType = 'Unknown';

    try {
      const parsed = JSON.parse(res.body) as readonly TripDataDTO[];
      if (Array.isArray(parsed)) {
        dataCount = parsed.length;
        const plates = [...new Set(parsed.map((t) => t.carNum))];
        responseType = `JSON Array (${dataCount} trips, plates: ${plates.join(', ')})`;
      }
    } catch {
      responseType = 'Non-JSON';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: res.statusCode,
      success: res.statusCode === 200,
      responseType,
      dataCount,
      responsePreview: truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testTypoEndpoint(): Promise<TestResult> {
  const name = '6. POST JSON to "Vehicule" URL (original Ituran URL)';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body: GetTripsRequest = {
      ...CREDENTIALS,
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '3',
    };

    const res = await httpRequest(ENDPOINT_TYPO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let responseType = 'Unknown';
    let dataCount: number | undefined;

    try {
      const parsed = JSON.parse(res.body);
      if (Array.isArray(parsed)) {
        dataCount = parsed.length;
        responseType = `JSON Array (${dataCount} trips)`;
      } else if (parsed.code) {
        responseType = `Error: ${parsed.code}`;
      }
    } catch {
      responseType = res.body.includes('Endpoint not found') ? 'Endpoint not found (404)' : 'Non-JSON';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT_TYPO,
      statusCode: res.statusCode,
      success: res.statusCode === 200,
      responseType,
      dataCount,
      responsePreview: truncate(res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT_TYPO,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testWsdlEndpoint(): Promise<TestResult> {
  const name = '7. GET WSDL metadata';
  try {
    const res = await httpRequest(`${BASE_URL}?wsdl`, { method: 'GET' });
    const hasWsdl = res.body.includes('wsdl:definitions');
    return {
      name,
      method: 'GET',
      url: `${BASE_URL}?wsdl`,
      statusCode: res.statusCode,
      success: res.statusCode === 200 && hasWsdl,
      responseType: hasWsdl ? 'WSDL XML (service metadata)' : 'Other',
      responsePreview: hasWsdl
        ? '[WSDL with ITripsDataService operations: GetTripsByDateDriverNVehicleNTripID, DoWork]'
        : truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'GET',
      url: `${BASE_URL}?wsdl`,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testSoap12Call(): Promise<TestResult> {
  const name = '8. SOAP 1.2 call (DoWork)';
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
  <soap12:Body>
    <tem:DoWork>
      <tem:var_test>hello</tem:var_test>
    </tem:DoWork>
  </soap12:Body>
</soap12:Envelope>`;

    const res = await httpRequest(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        SOAPAction: 'http://tempuri.org/ITripsDataService/DoWork',
      },
      body: soapBody,
    });

    return {
      name,
      method: 'POST (SOAP 1.2)',
      url: BASE_URL,
      statusCode: res.statusCode,
      success: false,
      responseType:
        res.statusCode === 404
          ? 'Endpoint not found (SOAP binding not exposed publicly)'
          : `HTTP ${res.statusCode}`,
      responsePreview: truncate(res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST (SOAP 1.2)',
      url: BASE_URL,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testSoap11Call(): Promise<TestResult> {
  const name = '9. SOAP 1.1 call (basicHttpBinding)';
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:DoWork>
      <tem:var_test>hello</tem:var_test>
    </tem:DoWork>
  </soap:Body>
</soap:Envelope>`;

    const res = await httpRequest(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"http://tempuri.org/ITripsDataService/DoWork"',
      },
      body: soapBody,
    });

    return {
      name,
      method: 'POST (SOAP 1.1)',
      url: BASE_URL,
      statusCode: res.statusCode,
      success: false,
      responseType:
        res.statusCode === 404
          ? 'Endpoint not found (basicHttpBinding not exposed)'
          : `HTTP ${res.statusCode}`,
      responsePreview: truncate(res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST (SOAP 1.1)',
      url: BASE_URL,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testInvalidCredentials(): Promise<TestResult> {
  const name = '10. POST JSON with invalid credentials';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body: GetTripsRequest = {
      userName: 'INVALID_USER',
      password: 'wrong_pass',
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '5',
    };

    const res = await httpRequest(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let responseType = 'Unknown';
    try {
      const parsed = JSON.parse(res.body) as ErrorResponse;
      if (parsed.code) {
        responseType = `Error response: code=${parsed.code}, message="${parsed.message}"`;
      }
    } catch {
      responseType = 'Non-JSON';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: res.statusCode,
      success: false,
      responseType,
      responsePreview: truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

async function testMissingCredentials(): Promise<TestResult> {
  const name = '11. POST JSON with missing userName';
  const { fromDate, toDate } = getYesterdayAndToday();
  try {
    const body = {
      plates: '',
      driverIds: '',
      fromTripId: '',
      fromDate,
      toDate,
      resultSize: '5',
    };

    const res = await httpRequest(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let responseType = 'Unknown';
    try {
      const parsed = JSON.parse(res.body) as ErrorResponse;
      if (parsed.code) {
        responseType = `Error response: code=${parsed.code}, message="${parsed.message}"`;
      }
    } catch {
      responseType = 'Non-JSON';
    }

    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: res.statusCode,
      success: false,
      responseType,
      responsePreview: truncate(res.body, 200),
    };
  } catch (err) {
    return {
      name,
      method: 'POST',
      url: ENDPOINT,
      statusCode: 0,
      success: false,
      responseType: 'Error',
      error: String(err),
      responsePreview: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('ITURAN REST API TEST REPORT');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Service: ${BASE_URL}`);
  console.log('='.repeat(80));
  console.log();

  const tests = [
    testGetServiceRoot,
    testGetEndpoint,
    testPostJsonWithCredentials,
    testPostJsonWithBasicAuth,
    testPostFilterByPlate,
    testTypoEndpoint,
    testWsdlEndpoint,
    testSoap12Call,
    testSoap11Call,
    testInvalidCredentials,
    testMissingCredentials,
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    try {
      console.log(`Running: ${test.name}...`);
      const result = await test();
      results.push(result);

      const icon = result.success ? '[PASS]' : '[FAIL]';
      console.log(`  ${icon} ${result.name}`);
      console.log(`    Method: ${result.method}`);
      console.log(`    Status: ${result.statusCode}`);
      console.log(`    Type:   ${result.responseType}`);
      if (result.dataCount !== undefined) {
        console.log(`    Data:   ${result.dataCount} records`);
      }
      console.log();
    } catch (err) {
      console.error(`  [ERROR] ${test.name}: ${err}`);
      console.log();
    }
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const working = results.filter((r) => r.success);
  const failing = results.filter((r) => !r.success);

  console.log(`\nWorking endpoints (${working.length}):`);
  for (const r of working) {
    console.log(`  + ${r.name}: ${r.responseType}`);
  }

  console.log(`\nNon-working endpoints (${failing.length}):`);
  for (const r of failing) {
    console.log(`  - ${r.name}: ${r.responseType}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDED INTEGRATION APPROACH');
  console.log('='.repeat(80));
  console.log(`
  Protocol:     REST (webHttpBinding on WCF)
  Method:       POST
  Content-Type: application/json
  URL:          ${ENDPOINT}
  Auth:         Credentials in JSON body (userName + password)

  Request body schema:
  {
    "userName":    string  (required - API username)
    "password":    string  (required - API password)
    "plates":      string  (optional - filter by plate, e.g. "HPS263")
    "driverIds":   string  (optional - filter by driver ID)
    "fromTripId":  string  (optional - paginate from trip ID)
    "fromDate":    string  (required - start date, format: YYYY-MM-DD)
    "toDate":      string  (required - end date, format: YYYY-MM-DD)
    "resultSize":  string  (optional - max results, e.g. "50")
  }

  Response: JSON array of TripDataDTO objects with fields:
    carNum, driveGrade, driveNumerator, driverCode,
    startDriveAddress, startDriveDate, startDriveKm, startDriveTime,
    endDriveAddress, endDriveDate, endDriveKm, endDriveTime,
    totalDriveKm, totalDriveTime, totalStandTime,
    fastestDriveSpeed, isNightDrive, originalTripId
  `);

  // Save full report
  const reportPath = path.join(TEST_DATA_DIR, 'ituran-rest-api-test-report.json');
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
