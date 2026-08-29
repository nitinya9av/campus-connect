const GATEWAY_LOGIN_URL = 'http://122.252.242.93/userportal/newlogin.do';
const GATEWAY_PORTAL_URL = 'http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html';
const CONNECTIVITY_URL = 'http://connectivitycheck.gstatic.com/generate_204';

/**
 * Checks if the device has actual internet access.
 * Returns true if Google 204 succeeds, false if redirected or failed.
 */
export async function checkInternetAccess(timeoutMs = 4000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(CONNECTIVITY_URL, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.status === 204;
  } catch (err) {
    return false;
  }
}

/**
 * Checks if the CURAJ captive portal gateway is reachable.
 */
export async function isGatewayReachable(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(GATEWAY_PORTAL_URL, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok || res.status === 200 || res.status === 302;
  } catch (err) {
    return false;
  }
}

/**
 * Authenticates with the CURAJ campus gateway using direct POST.
 */
export async function loginToGateway(username, password, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body = `user=${encodeURIComponent(username)}&pass=${encodeURIComponent(password)}`;

    const res = await fetch(GATEWAY_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) CampusConnect/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const text = await res.text();

    // Check response indicators
    const isSuccess = text.includes('Successful') ||
                      text.includes('already logged in') ||
                      text.includes('logout.do') ||
                      text.includes('Welcome') ||
                      res.status === 200;

    const isInvalid = text.includes('Invalid') ||
                      text.includes('Incorrect') ||
                      text.includes('authentication failed');

    if (isInvalid) {
      return { success: false, message: 'Invalid Mobile Number or Password.' };
    }

    // Verify actual connectivity after login
    const hasNet = await checkInternetAccess(3500);
    if (hasNet || isSuccess) {
      return { success: true, message: 'Connected successfully to CURAJ Wi-Fi.' };
    }

    return { success: true, message: 'Login request sent to gateway.' };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, message: 'Gateway request timed out.' };
    }
    return { success: false, message: 'Could not reach gateway: ' + err.message };
  }
}
