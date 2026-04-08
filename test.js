import axios from "axios";

const BILLING_API_BASE = "https://api.billing.gtwy.ai/api/v1";
const BILLING_AUTH_TOKEN = "Bearer e7f5c7ab-fe9d-4b1e-a4f6-63d333bfe068";
const PUBLIC_REFERENCEID = process.env.PUBLIC_REFERENCEID;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const PLAN_CODE = "free";

const billingHeaders = {
  Authorization: BILLING_AUTH_TOKEN,
  "Content-Type": "application/json"
};

async function getAllOrgs() {
  const response = await axios.get(`https://routes.msg91.com/api/${PUBLIC_REFERENCEID}/getCompanies?itemsPerPage=17321`, {
    headers: { authkey: ADMIN_API_KEY }
  });
  return response?.data?.data?.data ?? [];
}

async function createCustomer(orgId, orgName) {
  const response = await axios.post(
    `${BILLING_API_BASE}/customers`,
    {
      customer: {
        external_id: String(orgId),
        name: orgName || String(orgId),
        currency: "USD"
      }
    },
    { headers: billingHeaders }
  );
  return response.data;
}

async function assignSubscription(orgId) {
  const response = await axios.post(
    `${BILLING_API_BASE}/subscriptions`,
    {
      subscription: {
        external_customer_id: String(orgId),
        plan_code: PLAN_CODE,
        external_id: `sub_${orgId}`
      }
    },
    { headers: billingHeaders }
  );
  return response.data;
}

async function migrate() {
  console.log("Fetching all organizations...");
  const orgs = await getAllOrgs();
  console.log(`Found ${orgs.length} organizations\n`);

  let customersCreated = 0;
  let subscriptionsAssigned = 0;
  let failed = 0;

  for (const org of orgs) {
    const orgId = String(org.id);
    const orgName = org.name || orgId;

    try {
      console.log(`[${orgId}] Creating customer "${orgName}"...`);
      await createCustomer(orgId, orgName);
      customersCreated++;

      console.log(`[${orgId}] Assigning subscription (plan: ${PLAN_CODE})...`);
      await assignSubscription(orgId);
      subscriptionsAssigned++;

      console.log(`[${orgId}] Done\n`);
    } catch (error) {
      failed++;
      const msg = error.response?.data?.message || error.response?.data || error.message;
      console.error(`[${orgId}] Failed: ${JSON.stringify(msg)}\n`);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("=".repeat(60));
  console.log("Migration Summary:");
  console.log(`  Total orgs:              ${orgs.length}`);
  console.log(`  Customers created:       ${customersCreated}`);
  console.log(`  Subscriptions assigned:  ${subscriptionsAssigned}`);
  console.log(`  Failed:                  ${failed}`);
  console.log("=".repeat(60));
}

migrate()
  .then(() => {
    console.log("\nMigration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nMigration failed:", error.message);
    process.exit(1);
  });
