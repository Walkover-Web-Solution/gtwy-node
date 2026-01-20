import axios from 'axios';
import { findInCache, storeInCache } from '../cache_service/index.js';
import { objectToQueryParams } from './utils/utility.service.js';

async function fetchProxyDetails(referenceId, params = {}, options = {}) {
  const response = await axios.get(
    `${process.env.PROXY_BASE_URL}/${referenceId}/getDetails`,
    {
      params,
      headers: {
        'Content-Type': 'application/json',
        Authkey: process.env.PROXY_ADMIN_TOKEN,
        ...options.headers,
      },
    }
  );
  return response;
}

async function putProxyDetails(referenceId, updateObject, options = {}) {
  const response = await axios.put(
    `${process.env.PROXY_BASE_URL}/${referenceId}/updateDetails`,
    updateObject,
    {
      headers: {
        'Content-Type': 'application/json',
        Authkey: process.env.PROXY_ADMIN_TOKEN,
        ...options.headers,
      },
    }
  );
  return response;
}

export async function getUserOrgMapping(userId, orgId) {
  try {
    if (!userId || !orgId) throw new Error('Sorry, Either the fields are missing or you are not authorized!');
    const cache_key = `userOrgMapping-${userId}-${orgId}`;
    const data = await findInCache(cache_key);
    if (data) return JSON.parse(data);
    const response = await fetchProxyDetails(
      process.env.PROXY_USER_REFERENCE_ID,
      { company_id: orgId, user_id: userId }
    );
    // eslint-disable-next-line no-constant-binary-expression
    const result = (parseInt(response?.data?.data?.totalEntityCount, 10) === 1) ?? false;
    storeInCache(cache_key, result);
    return result;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    throw error; // Re-throw the error for the caller to handle
  }
}

export const switchOrganization = async (data, proxyToken) => {
  const organization = await axios.post(`${process.env.PROXY_BASE_URL}/c/switchCompany`, data, {
    headers: {
      Proxy_auth_token: proxyToken,
    },
  });
  return organization;
};


export async function getOrganizationById(orgId) {
  try {
    const response = await axios.get(`${process.env.PROXY_BASE_URL}/${process.env.PROXY_USER_REFERENCE_ID}/getCompanies?id=${orgId}`, { // TODO not provided by proxy
      headers: {
        'Content-Type': 'application/json',
        Authkey: process.env.PROXY_ADMIN_TOKEN,
      },
      // You can include credentials if required (e.g., 'withCredentials': true)
    });

    const data = response?.data?.data?.data?.[0];
    return data; // data.org kardena if giving undefined.
  } catch (error) {
    console.error('Error fetching data:', error.message);
    throw error; // Re-throw the error for the caller to handle
  }
}


export async function createOrFindUserAndCompany(userOrgObject) {
  try {
    const response = await axios.post(`${process.env.PROXY_BASE_URL}/createCUsers`, userOrgObject, {
      headers: {
        'Content-Type': 'application/json',
        Authkey: process.env.PROXY_ADMIN_TOKEN,
      },
    });

    const data = response?.data;
    return data;
  } catch (error) {
    console.error('Error leaving company:', error.message);
    throw error; // Re-throw the error for the caller to handle
  }
}



export async function updateOrganizationData(orgId, orgDetails) {
  const updateObject = {
    company_id: orgId,
    company: orgDetails,
  };
  try {
    const response = await putProxyDetails(process.env.PROXY_USER_REFERENCE_ID, updateObject);
    return response?.data;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    throw error;
  }
}

export async function createProxyToken(token_data) {
  try {
    const queryData = objectToQueryParams(token_data);
    const response = await axios.get(`${process.env.PROXY_BASE_URL}/${process.env.PROXY_USER_REFERENCE_ID}/getAuthToken?${queryData}`, {
      headers: {
        'Content-Type': 'application/json',
        Authkey: process.env.PROXY_ADMIN_TOKEN,
        // Add any other headers if needed
      },
      // You can include credentials if required (e.g., 'withCredentials': true)
    });

    const data = response?.data;
    return data?.data?.proxy_auth_token;
  } catch (error) {
    console.error('Error creating token:', error.message);
    throw error; // Re-throw the error for the caller to handle
  }
}

export async function getUsers(org_id, page = 1, pageSize = 10) {
  try {
    const response = await fetchProxyDetails(
      process.env.PUBLIC_REFERENCEID,
      { company_id: org_id, pageNo: page, itemsPerPage: pageSize }
    );
    return response?.data?.data;
  } catch (error) {
    console.error('Error fetching user updates:', error.message);
    return [];
  }
}

export async function validateCauthKey(pauthkey) {
  try {
    const response = await axios.post(`${process.env.PROXY_BASE_URL}/validateCauthKey`, {
      "cAuthKey": pauthkey
    }, {
      headers: {
        authkey: process.env.PROXY_ADMIN_TOKEN,
      },
    });
    return response?.data;
  } catch (error) {
    const err = new Error(error?.response?.data?.message || 'Failed to validate cAuth key');
    err.statusCode = error?.response?.status;
    err.data = error?.response?.data;
    console.error('Error validating cAuth key:', error.message);
    throw err;
  }
}

export async function updateProxyDetails(updateObject) {
  try {
    const response = await putProxyDetails(process.env.PROXY_USER_REFERENCE_ID, updateObject);
    return response.data;
  } catch (error) {
    console.error('Error updating details:', error);
    throw error;
  }
}

export async function getProxyDetails(params) {
  try {
    const response = await fetchProxyDetails(process.env.PUBLIC_REFERENCEID, params);
    return response.data;
  } catch (error) {
    console.error('Error fetching details:', error.message);
    throw error;
  }
}

export async function removeClientUser(userId, companyId, featureId) {
  try {
    const response = await axios.post(
      `${process.env.PROXY_BASE_URL}/clientUsers/${userId}/remove?feature_id=${featureId}&company_id=${companyId}`,
      null,
      {
        headers: {
          'Content-Type': 'application/json',
          Authkey: process.env.PROXY_ADMIN_TOKEN,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error('Error removing client user:', error.message);
    throw error;
  }
}
