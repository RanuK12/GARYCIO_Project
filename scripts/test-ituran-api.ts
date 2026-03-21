/**
 * Test directo de la API SOAP de Ituran Argentina.
 * Basado en el WSDL real de Service3.asmx.
 *
 * Uso: npx tsx scripts/test-ituran-api.ts
 */

const ITURAN_USER = "garycio";
const ITURAN_PASSWORD = "gargiulOK2015";
const BASE_URL = "https://web2.ituran.com.ar/ituranwebservice3/Service3.asmx";

const NAMESPACE = "http://www.ituran.com/ituranWebService3";

async function callSOAP(action: string, bodyXml: string): Promise<{ status: number; body: string }> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="${NAMESPACE}">
  <soap:Body>
    ${bodyXml}
  </soap:Body>
</soap:Envelope>`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `${NAMESPACE}/${action}`,
      },
      body: envelope,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const body = await response.text();
    return { status: response.status, body };
  } catch (error: any) {
    return { status: 0, body: error.message };
  }
}

async function main() {
  const fs = await import("fs");

  console.log("===========================================");
  console.log("  TEST ITURAN API - PARAMETROS CORRECTOS");
  console.log("===========================================\n");

  // ---- TEST 1: GetAllPlatformsData (posición actual de TODOS los vehículos) ----
  console.log("📡 TEST 1: GetAllPlatformsData (posiciones actuales)...");
  const r1 = await callSOAP("GetAllPlatformsData", `
    <tns:GetAllPlatformsData>
      <tns:UserName>${ITURAN_USER}</tns:UserName>
      <tns:Password>${ITURAN_PASSWORD}</tns:Password>
      <tns:ShowAreas>true</tns:ShowAreas>
      <tns:ShowStatuses>true</tns:ShowStatuses>
      <tns:ShowMileageInMeters>true</tns:ShowMileageInMeters>
      <tns:ShowDriver>true</tns:ShowDriver>
    </tns:GetAllPlatformsData>`);

  console.log(`   HTTP ${r1.status} - ${r1.body.length} chars`);
  if (r1.status === 200) {
    fs.writeFileSync("test-data/ituran-GetAllPlatformsData.xml", r1.body);
    console.log(`   💾 Guardado en test-data/ituran-GetAllPlatformsData.xml`);
    analyzeResponse("GetAllPlatformsData", r1.body);
  } else {
    console.log(`   ❌ Error: ${r1.body.substring(0, 300)}`);
  }

  // ---- TEST 2: GetAllPlatformsData_JSON ----
  console.log("\n📡 TEST 2: GetAllPlatformsData_JSON...");
  const r2 = await callSOAP("GetAllPlatformsData_JSON", `
    <tns:GetAllPlatformsData_JSON>
      <tns:UserName>${ITURAN_USER}</tns:UserName>
      <tns:Password>${ITURAN_PASSWORD}</tns:Password>
      <tns:ShowAreas>true</tns:ShowAreas>
      <tns:ShowStatuses>true</tns:ShowStatuses>
      <tns:ShowMileageInMeters>true</tns:ShowMileageInMeters>
      <tns:ShowDriver>true</tns:ShowDriver>
    </tns:GetAllPlatformsData_JSON>`);

  console.log(`   HTTP ${r2.status} - ${r2.body.length} chars`);
  if (r2.status === 200) {
    fs.writeFileSync("test-data/ituran-GetAllPlatformsData_JSON.xml", r2.body);
    console.log(`   💾 Guardado`);
    analyzeResponse("GetAllPlatformsData_JSON", r2.body);
  } else {
    console.log(`   ❌ Error: ${r2.body.substring(0, 300)}`);
  }

  // ---- TEST 3: GetFullReport (historial) ----
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const fmtDate = (d: Date) => d.toISOString().replace("T", " ").substring(0, 19);

  console.log(`\n📡 TEST 3: GetFullReport (últimas 2h, all vehicles)...`);
  console.log(`   Start: ${fmtDate(twoHoursAgo)} | End: ${fmtDate(now)}`);
  const r3 = await callSOAP("GetFullReport", `
    <tns:GetFullReport>
      <tns:UserName>${ITURAN_USER}</tns:UserName>
      <tns:Password>${ITURAN_PASSWORD}</tns:Password>
      <tns:Plate>all</tns:Plate>
      <tns:Start>${fmtDate(twoHoursAgo)}</tns:Start>
      <tns:End>${fmtDate(now)}</tns:End>
      <tns:UAID>0</tns:UAID>
      <tns:MaxNumberOfRecords>100</tns:MaxNumberOfRecords>
    </tns:GetFullReport>`);

  console.log(`   HTTP ${r3.status} - ${r3.body.length} chars`);
  if (r3.status === 200) {
    fs.writeFileSync("test-data/ituran-GetFullReport.xml", r3.body);
    console.log(`   💾 Guardado`);
    analyzeResponse("GetFullReport", r3.body);
  } else {
    console.log(`   ❌ Error: ${r3.body.substring(0, 300)}`);
  }

  // ---- TEST 4: GetFullReport_JSON ----
  console.log(`\n📡 TEST 4: GetFullReport_JSON (últimas 2h)...`);
  const r4 = await callSOAP("GetFullReport_JSON", `
    <tns:GetFullReport_JSON>
      <tns:UserName>${ITURAN_USER}</tns:UserName>
      <tns:Password>${ITURAN_PASSWORD}</tns:Password>
      <tns:Plate>all</tns:Plate>
      <tns:Start>${fmtDate(twoHoursAgo)}</tns:Start>
      <tns:End>${fmtDate(now)}</tns:End>
      <tns:UAID>0</tns:UAID>
      <tns:MaxNumberOfRecords>100</tns:MaxNumberOfRecords>
    </tns:GetFullReport_JSON>`);

  console.log(`   HTTP ${r4.status} - ${r4.body.length} chars`);
  if (r4.status === 200) {
    fs.writeFileSync("test-data/ituran-GetFullReport_JSON.xml", r4.body);
    console.log(`   💾 Guardado`);
    analyzeResponse("GetFullReport_JSON", r4.body);
  } else {
    console.log(`   ❌ Error: ${r4.body.substring(0, 300)}`);
  }

  // ---- TEST 5: GetAllPlatformsDataShortened ----
  console.log(`\n📡 TEST 5: GetAllPlatformsDataShortened...`);
  const r5 = await callSOAP("GetAllPlatformsDataShortened", `
    <tns:GetAllPlatformsDataShortened>
      <tns:UserName>${ITURAN_USER}</tns:UserName>
      <tns:Password>${ITURAN_PASSWORD}</tns:Password>
    </tns:GetAllPlatformsDataShortened>`);

  console.log(`   HTTP ${r5.status} - ${r5.body.length} chars`);
  if (r5.status === 200) {
    fs.writeFileSync("test-data/ituran-GetAllPlatformsDataShortened.xml", r5.body);
    console.log(`   💾 Guardado`);
    analyzeResponse("GetAllPlatformsDataShortened", r5.body);
  } else {
    console.log(`   ❌ Error: ${r5.body.substring(0, 300)}`);
  }

  console.log("\n===========================================");
  console.log("  FIN DE TESTS");
  console.log("===========================================");
}

function analyzeResponse(name: string, xml: string) {
  const isFault = xml.includes("<faultstring>") || xml.includes("<Fault>");
  if (isFault) {
    const faultMsg = xml.match(/<faultstring>([^<]+)/)?.[1] ||
                     xml.match(/<faultcode>([^<]+)/)?.[1] ||
                     "Unknown fault";
    console.log(`   ⚠️  SOAP Fault: ${faultMsg}`);
    return;
  }

  // Check for ReturnCode
  const returnCode = xml.match(/<ReturnCode>([^<]+)/)?.[1];
  if (returnCode) {
    console.log(`   📋 ReturnCode: ${returnCode}`);
  }

  // Check for error indicators
  const errorMsg = xml.match(/<ErrorMessage>([^<]+)/)?.[1] ||
                   xml.match(/<Message>([^<]+)/)?.[1];
  if (errorMsg) {
    console.log(`   📋 Message: ${errorMsg}`);
  }

  // Check for vehicle/platform data
  const plates = xml.match(/<Plate>([^<]+)/g) || [];
  const lats = xml.match(/<Lat(?:itude)?>([^<]+)/g) || [];
  const speeds = xml.match(/<Speed>([^<]+)/g) || [];

  if (plates.length > 0) {
    console.log(`   ✅ DATOS DE VEHÍCULOS ENCONTRADOS!`);
    console.log(`      Patentes: ${plates.length}`);
    console.log(`      Coordenadas: ${lats.length}`);
    console.log(`      Velocidades: ${speeds.length}`);

    // Show first few plates
    const uniquePlates = [...new Set(plates.map(p => p.replace(/<Plate>/, "")))];
    console.log(`      Patentes: ${uniquePlates.slice(0, 10).join(", ")}`);
  }

  // Show preview
  console.log(`\n   📝 Preview (primeros 1500 chars):`);
  // Strip XML envelope, show just body content
  const bodyContent = xml.match(/<soap:Body>([\s\S]*)<\/soap:Body>/)?.[1] || xml;
  console.log(bodyContent.substring(0, 1500));
  if (bodyContent.length > 1500) console.log(`   ... (${bodyContent.length - 1500} chars más)`);
}

main().catch(console.error);
