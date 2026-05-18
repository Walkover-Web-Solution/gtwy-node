import axios from "axios";
import "dotenv/config";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const BILLING_EVENT_CODE = process.env.BILLING_EVENT_CODE;
const PUBLIC_REFERENCEID = process.env.PUBLIC_REFERENCEID;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const billingHeaders = {
  Authorization: `Bearer ${BILLING_API_KEY}`,
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
    `${BILLING_API_URL}/customers`,
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
    `${BILLING_API_URL}/subscriptions`,
    {
      subscription: {
        external_customer_id: String(orgId),
        plan_code: BILLING_EVENT_CODE,
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

      console.log(`[${orgId}] Assigning subscription (plan: ${BILLING_EVENT_CODE})...`);
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
