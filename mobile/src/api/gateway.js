const GATEWAY_LOGIN_URL = 'http://122.252.242.93/userportal/newlogin.do';
const GATEWAY_PORTAL_URL = 'http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html';
const NAS_URL = 'http://1.254.254.254/';

// Multiple high-reliability 204 endpoints (HTTPS avoids cleartext interception and cert spoofing)
const CONNECTIVITY_URLS = [
  'https://www.google.com/generate_204',
  'https://connectivitycheck.gstatic.com/generate_204',
  'http://connectivitycheck.gstatic.com/generate_204',
];

/**
 * Checks if the device has actual internet access.
 * Probes Google 204 endpoints. Returns true if genuine 204 No Content is returned.
 */
export async function checkInternetAccess(timeoutMs = 3000) {
  for (const url of CONNECTIVITY_URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (res.status === 204) {
        return true;
      }
    } catch (err) {
      // Continue to next endpoint fallback
    }
  }
  return false;
}

/**
 * Checks if the CURAJ captive portal gateway or NAS is reachable on the local network.
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
 * Authenticates with the CURAJ campus gateway using direct POST and Inventum NAS handshake.
 */
export async function loginToGateway(username, password, timeoutMs = 8000) {
  try {
    let sessionCookie = '';

    // 1. Prime session with Inventum NAS controller (triggers client MAC/IP registration)
    try {
      const nasController = new AbortController();
      const nasTimeout = setTimeout(() => nasController.abort(), 1200);
      const nasRes = await fetch(NAS_URL, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        signal: nasController.signal,
      });
      clearTimeout(nasTimeout);
      const nasHtml = await nasRes.text();

      // Extract the Inventum redirect URL: URL=http://122.252.242.93/userportal/?...
      const urlMatch = nasHtml.match(/URL=(http:\/\/[^"'>\s]+)/i);
      if (urlMatch && urlMatch[1]) {
        const portalUrl = urlMatch[1];
        
        // 2. Fetch the userportal challenge URL to get JSESSIONID bound to client MAC/IP
        const portalController = new AbortController();
        const portalTimeout = setTimeout(() => portalController.abort(), 1500);
        const portalRes = await fetch(portalUrl, {
          method: 'GET',
          signal: portalController.signal,
        });
        clearTimeout(portalTimeout);

        // Extract JSESSIONID if present in Set-Cookie
        const setCookie = portalRes.headers.get('set-cookie');
        if (setCookie) {
          const cookieMatch = setCookie.match(/(JSESSIONID=[^;]+)/i);
          if (cookieMatch) {
            sessionCookie = cookieMatch[1];
          }
        }
      } else {
        // If NAS returned no redirect, check if internet is already working
        const alreadyOnline = await checkInternetAccess(1000);
        if (alreadyOnline) {
          return { success: true, message: 'Already connected to campus internet.' };
        }
      }
    } catch (e) {
      // NAS probe failed, proceed to direct login or check if already online
      const alreadyOnline = await checkInternetAccess(1000);
      if (alreadyOnline) {
        return { success: true, message: 'Already connected to campus internet.' };
      }
    }

    // 3. POST credentials to userportal endpoint
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&phone=0&type=2&jsonresponse=1`;

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': GATEWAY_PORTAL_URL,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) CampusConnect/1.0',
    };
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    const loginController = new AbortController();
    const loginTimeout = setTimeout(() => loginController.abort(), 2500);

    const res = await fetch(GATEWAY_LOGIN_URL, {
      method: 'POST',
      headers,
      body,
      signal: loginController.signal,
    });

    clearTimeout(loginTimeout);
    const text = await res.text();

    // 4. Trigger NAS controller handshake if redirect_to_nas is requested
    if (text.includes('redirect_to_nas')) {
      try {
        const pingController = new AbortController();
        const pingTimeout = setTimeout(() => pingController.abort(), 1000);
        await fetch(NAS_URL, { method: 'GET', signal: pingController.signal });
        clearTimeout(pingTimeout);
      } catch {}
    }

    // 5. Check error diagnostics
    if (text.includes('Invalid') || text.includes('Incorrect') || text.includes('authentication failed')) {
      return { success: false, message: 'Invalid Mobile Number or Password.' };
    }

    // 6. Immediate success detection
    if (text.includes('redirect_to_nas') || text.includes('success_net') || text.includes('"errorKey":"success"') || text.includes('Session already running')) {
      return { success: true, message: 'Connected successfully to CURAJ Wi-Fi.' };
    }

    // Fallback fast check
    const isOnlineNow = await checkInternetAccess(1200);
    if (isOnlineNow) {
      return { success: true, message: 'Connected successfully to CURAJ Wi-Fi.' };
    }

    return {
      success: false,
      message: text ? `Gateway response: ${text.trim().slice(0, 100)}` : 'Could not verify internet access.',
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, message: 'Gateway request timed out.' };
    }
    return { success: false, message: 'Could not reach gateway: ' + err.message };
  }
}


