import axios from "axios";

const BILLING_API_URL = process.env.BILLING_API_URL;
const BILLING_API_KEY = process.env.BILLING_API_KEY;
const BILLING_EVENT_CODE = process.env.BILLING_EVENT_CODE;

const billingHeaders = () => ({
  Authorization: `Bearer ${BILLING_API_KEY}`,
  "Content-Type": "application/json"
});

export const createCustomer = async (org_id) => {
  const response = await axios.post(
    `${BILLING_API_URL}/customers`,
    {
      customer: {
        external_id: org_id,
        name: org_id
      }
    },
    { headers: billingHeaders() }
  );
  return response.data;
};

export const createSubscription = async (org_id) => {
  const response = await axios.post(
    `${BILLING_API_URL}/subscriptions`,
    {
      subscription: {
        external_customer_id: org_id,
        plan_code: BILLING_EVENT_CODE,
        external_id: org_id,
        billing_time: "calendar"
      }
    },
    { headers: billingHeaders() }
  );
  return response.data;
};

export const ensureOrgSubscribed = async (org_id) => {
  const customer = await createCustomer(org_id);
  const subscription = await createSubscription(org_id);
  return { customer, subscription };
};
