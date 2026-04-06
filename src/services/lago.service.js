import axios from "axios";

const LAGO_API_URL = process.env.LAGO_API_URL;
const LAGO_API_KEY = process.env.LAGO_API_KEY;
const LAGO_FREE_PLAN_CODE = process.env.LAGO_FREE_PLAN_CODE;

const lagoHeaders = () => ({
  Authorization: `Bearer ${LAGO_API_KEY}`,
  "Content-Type": "application/json"
});

export const createCustomer = async (org_id) => {
  const response = await axios.post(
    `${LAGO_API_URL}/customers`,
    {
      customer: {
        external_id: org_id,
        name: org_id
      }
    },
    { headers: lagoHeaders() }
  );
  return response.data;
};

export const createSubscription = async (org_id) => {
  const response = await axios.post(
    `${LAGO_API_URL}/subscriptions`,
    {
      subscription: {
        external_customer_id: org_id,
        plan_code: LAGO_FREE_PLAN_CODE,
        external_id: org_id,
        billing_time: "calendar"
      }
    },
    { headers: lagoHeaders() }
  );
  return response.data;
};

export const ensureOrgSubscribed = async (org_id) => {
  const customer = await createCustomer(org_id);
  const subscription = await createSubscription(org_id);
  return { customer, subscription };
};
