/**
 * Helpers for the "61/62 Master Data Import Sync (E2E)" folders: arrange tenant /
 * branch master data through the real API (axios) and read back branch state for
 * assertions. Needs the Bruno CLI's developer sandbox (`bru run --sandbox developer`).
 *
 * Runtime vars used (set by the 61 setup requests):
 *   tenantToken  — business admin (no active branch) — writes Tenant Master Data
 *   branchToken  — branch admin of the e2e branch — runs the import
 *   tenantMdId / branchMdId — the two master data ids
 */
const axios = require('axios');

function client(bru, tokenVar) {
  return axios.create({
    baseURL: bru.getEnvVar('baseUrl'),
    headers: { Authorization: `Bearer ${bru.getVar(tokenVar)}` },
    validateStatus: () => true,
  });
}

function ok(r, what) {
  if (r.status >= 300 || !r.data || r.data.success === false) {
    throw new Error(
      `${what} failed: HTTP ${r.status} ${JSON.stringify(r.data && r.data.error)}`,
    );
  }
  return r.data.data;
}

function testBody(testName, testCode, params) {
  return {
    testName,
    testCode,
    processMethod: 'SINGLE_STEP',
    samplePriorityType: 'ROUTINE',
    priceMsrp: 700,
    priceMaximum: 650,
    priceMinimum: 400,
    samples: [
      {
        containerType: 'EDTA_TUBE_PURPLE_TOP',
        sampleSize: '3 mL',
        numberOfSamples: 1,
        isFastingRequired: false,
        isDefault: true,
      },
    ],
    resultParams: (params || [{ name: 'Haemoglobin', code: 'HB' }]).map(
      (p, i) => ({
        parameterName: p.name,
        parameterCode: p.code,
        reportingUnit: 'g/dL',
        resultType: 'QUANTITATIVE',
        parameterType: 'MEASURED',
        decimalPlaces: 1,
        sortOrder: i + 1,
      }),
    ),
  };
}

async function createTenantTest(bru, testName, testCode, params) {
  const r = await client(bru, 'tenantToken').post(
    `/master-data/${bru.getVar('tenantMdId')}/lab-tests`,
    testBody(testName, testCode, params),
  );
  return ok(r, `create tenant test ${testName}`).id;
}

async function updateTenantTest(bru, id, patch) {
  const r = await client(bru, 'tenantToken').patch(
    `/master-data/${bru.getVar('tenantMdId')}/lab-tests/${id}`,
    patch,
  );
  return ok(r, `update tenant test ${id}`);
}

async function deleteTenantTest(bru, id) {
  const r = await client(bru, 'tenantToken').delete(
    `/master-data/${bru.getVar('tenantMdId')}/lab-tests/${id}`,
  );
  return ok(r, `delete tenant test ${id}`);
}

/** A hand-created branch test (business admin; no tenant source link). */
async function createBranchTest(bru, testName, testCode) {
  const r = await client(bru, 'tenantToken').post(
    `/master-data/${bru.getVar('branchMdId')}/lab-tests`,
    testBody(testName, testCode),
  );
  return ok(r, `create branch test ${testName}`).id;
}

async function deleteBranchTest(bru, id) {
  const r = await client(bru, 'tenantToken').delete(
    `/master-data/${bru.getVar('branchMdId')}/lab-tests/${id}`,
  );
  return ok(r, `delete branch test ${id}`);
}

async function listTests(bru, mdVar) {
  const r = await client(bru, 'tenantToken').get(
    `/master-data/${bru.getVar(mdVar)}/lab-tests`,
    { params: { page: 1, limit: 100 } },
  );
  return ok(r, `list tests of ${mdVar}`);
}

/** Active branch tests as [{id, testName, testCode, sourceMasterLabTestId}]. */
async function branchTests(bru) {
  return (await listTests(bru, 'branchMdId')).map((t) => ({
    id: t.id,
    testName: t.testName,
    testCode: t.testCode,
    sourceMasterLabTestId: t.sourceMasterLabTestId,
  }));
}

async function tenantTests(bru) {
  return listTests(bru, 'tenantMdId');
}

async function branchTestDetail(bru, id) {
  const r = await client(bru, 'tenantToken').get(
    `/master-data/${bru.getVar('branchMdId')}/lab-tests/${id}`,
  );
  return ok(r, `get branch test ${id}`);
}

async function createTenantPanel(bru, panelName, panelCode, labTestIds) {
  const r = await client(bru, 'tenantToken').post(
    `/master-data/${bru.getVar('tenantMdId')}/lab-panels`,
    {
      panelName,
      panelCode,
      applicableGender: 'ALL',
      applicableAgeGroup: 'ADULT',
      reportType: 'COMBINED',
      turnaroundPriority: 'ROUTINE',
      isActive: true,
      priceMsrp: 2500,
      priceMaximum: 2300,
      priceMinimum: 1800,
      isAllowPartialBilling: true,
      maxTestsRemovable: 1,
      tests: labTestIds.map((labTestId, i) => ({
        labTestId,
        sortOrder: i + 1,
        isRemovable: true,
      })),
    },
  );
  return ok(r, `create tenant panel ${panelName}`).id;
}

async function branchPanels(bru) {
  const r = await client(bru, 'tenantToken').get(
    `/master-data/${bru.getVar('branchMdId')}/lab-panels`,
    { params: { page: 1, limit: 100 } },
  );
  return ok(r, 'list branch panels');
}

async function branchPanelDetail(bru, id) {
  const r = await client(bru, 'tenantToken').get(
    `/master-data/${bru.getVar('branchMdId')}/lab-panels/${id}`,
  );
  return ok(r, `get branch panel ${id}`);
}

/** Raw import call (branch admin) — returns {status, body}, never throws. */
async function runImport(bru) {
  const r = await client(bru, 'branchToken').post(
    '/master-data/branch/import-from-tenant',
  );
  return { status: r.status, body: r.data };
}

function byName(rows) {
  return Object.fromEntries(rows.map((t) => [t.testName, t]));
}

function getJson(bru, name) {
  const v = bru.getVar(name);
  return v ? JSON.parse(v) : {};
}

function setJson(bru, name, value) {
  bru.setVar(name, JSON.stringify(value));
}

module.exports = {
  createTenantTest,
  updateTenantTest,
  deleteTenantTest,
  createBranchTest,
  deleteBranchTest,
  branchTests,
  tenantTests,
  branchTestDetail,
  createTenantPanel,
  branchPanels,
  branchPanelDetail,
  runImport,
  byName,
  getJson,
  setJson,
};
