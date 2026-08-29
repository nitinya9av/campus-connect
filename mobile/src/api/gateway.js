const GATEWAY_LOGIN_URL = 'http://122.252.242.93/userportal/newlogin.do';
const GATEWAY_PORTAL_URL = 'http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html';
const NAS_URL = 'http://1.254.254.254/';
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
 * Checks if the CURAJ captive portal gateway or NAS is reachable.
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
    try {
      const resNas = await fetch(NAS_URL, { method: 'GET' });
      return resNas.ok || resNas.status === 200;
    } catch {
      return false;
    }
  }
}

/**
 * Authenticates with the CURAJ campus gateway using direct POST.
 */
export async function loginToGateway(username, password, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Official CURAJ form parameters
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&phone=0&type=2&jsonresponse=1`;

    const res = await fetch(GATEWAY_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': GATEWAY_PORTAL_URL,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) CampusConnect/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const text = await res.text();

    // Trigger NAS controller handshake if requested
    if (text.includes('redirect_to_nas')) {
      try {
        await fetch(NAS_URL, { method: 'GET' });
      } catch {}
    }

    // Check specific portal diagnostics
    const isInvalid = text.includes('Invalid') ||
                      text.includes('Incorrect') ||
                      text.includes('authentication failed');

    if (isInvalid) {
      return { success: false, message: 'Invalid Mobile Number or Password.' };
    }

    // Verify actual connectivity after login
    await new Promise(r => setTimeout(r, 1000));
    const hasNet = await checkInternetAccess(3500);
    if (hasNet) {
      return { success: true, message: 'Connected successfully to CURAJ Wi-Fi.' };
    }

    if (text.includes('Session already running')) {
      return { success: false, message: 'Session active on another port. Re-checking...' };
    }

    return { success: true, message: 'Login sent. Verifying connectivity...' };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, message: 'Gateway request timed out.' };
    }
    return { success: false, message: 'Could not reach gateway: ' + err.message };
  }
}

