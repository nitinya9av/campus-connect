import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  AppState,
  NativeModules,
  Linking,
} from 'react-native';

const { CampusConnectModule } = NativeModules;
import NetInfo from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './src/styles/theme';
import { saveCredentials, getCredentials, clearCredentials } from './src/storage/credentials';
import { loginToGateway, checkInternetAccess, isGatewayReachable, isCampusLocalNetwork } from './src/api/gateway';

export default function App() {
  return (
    <SafeAreaProvider>
      <CampusConnectMain />
    </SafeAreaProvider>
  );
}

function CampusConnectMain() {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  // networkState values:
  //   'checking'      — initial probe in progress
  //   'online'        — registered + authenticated + internet confirmed
  //   'unregistered'  — on CURAJ WiFi but no credentials saved yet (Issue 1)
  //   'login_needed'  — registered, on CURAJ WiFi, but captive portal not yet open
  //   'no_internet'   — WiFi hardware up but gateway/ISP down, internet fully absent (Issue 2)
  //   'external'      — cellular or non-CURAJ WiFi
  //   'offline'       — no network at all
  const [networkState, setNetworkState] = useState('checking');
  const networkStateRef = useRef('checking');
  // Keep ref in sync — lets interval callbacks read latest state without stale closures
  const setNetwork = useCallback((val) => {
    networkStateRef.current = val;
    setNetworkState(val);
  }, []);
  const [statusMessage, setStatusMessage] = useState({
    type: 'neutral', // 'success', 'error', 'neutral'
    text: 'Initializing Campus Connect...',
  });

  const isAuthenticatingRef = useRef(false);
  const isRegisteredRef = useRef(false); // mirrors isRegistered — safe to read in async callbacks
  const usernameRef = useRef(username);
  const passwordRef = useRef(password);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  useEffect(() => {
    isRegisteredRef.current = isRegistered;
  }, [isRegistered]);

  // Intelligent Network Environment Detector: accurately identifies CURAJ Wi-Fi even when Mobile Data is active
  const detectEnvironment = useCallback(async () => {
    // 1. On Android, query native hardware Wi-Fi network & SSID
    if (Platform.OS === 'android' && CampusConnectModule?.getWifiStatus) {
      try {
        const nativeStatus = await CampusConnectModule.getWifiStatus();
        if (nativeStatus && nativeStatus.isWifiConnected) {
          const ssidName = nativeStatus.ssid || '';
          const isCuraj = nativeStatus.isCurajSsid ||
            nativeStatus.isCurajPortalReachable ||
            ssidName.toUpperCase() === 'CURAJ CAMPUS CONNECT' ||
            ssidName.toUpperCase().includes('CURAJ') ||
            ssidName.toUpperCase().includes('CAMPUS CONNECT');

          if (isCuraj) {
            return {
              type: 'curaj_wifi',
              ssid: ssidName || 'CURAJ CAMPUS CONNECT',
              isOnline: nativeStatus.isWifiOnline,
              hasCellular: nativeStatus.hasCellular,
            };
          } else {
            return {
              type: 'external_wifi',
              ssid: ssidName || 'External Wi-Fi',
              isOnline: nativeStatus.isWifiOnline,
              hasCellular: nativeStatus.hasCellular,
            };
          }
        }
      } catch (e) {
        console.warn('Native getWifiStatus check error:', e);
      }
    }

    // 2. Fallback using NetInfo and standard fetch probes
    const net = await NetInfo.fetch();
    if (!net.isConnected || net.type === 'none') {
      return { type: 'offline' };
    }

    const isCuraj = await isCampusLocalNetwork(1500);
    const hasNet = await checkInternetAccess(1500);

    if (isCuraj) {
      return { type: 'curaj_wifi', ssid: 'CURAJ Wi-Fi', isOnline: hasNet };
    }

    if (net.type === 'cellular') {
      return { type: 'cellular', isOnline: hasNet };
    }

    return { type: 'external_wifi', ssid: 'External Wi-Fi', isOnline: hasNet };
  }, []);

  // Core automated login macro: runs silently and seamlessly
  const runAutoLogin = useCallback(async (user, pass, source = 'macro') => {
    const targetUser = user || usernameRef.current;
    const targetPass = pass || passwordRef.current;

    if (!targetUser || !targetPass) return;
    if (isAuthenticatingRef.current) return;

    const env = await detectEnvironment();

    if (env.type === 'offline') {
      setNetwork('offline');
      setStatusMessage({
        type: 'error',
        text: '⚠ Device is offline. Please turn on Wi-Fi.',
      });
      return;
    }

    if (env.type === 'cellular') {
      setNetwork('external');
      setStatusMessage({
        type: 'neutral',
        text: 'Connected via mobile data. Campus auto-login requires CURAJ Wi-Fi.',
      });
      return;
    }

    if (env.type === 'external_wifi') {
      setNetwork('external');
      setStatusMessage({
        type: 'neutral',
        text: `Connected to "${env.ssid}". CURAJ auto-login is active on campus Wi-Fi.`,
      });
      return;
    }

    // We are on CURAJ campus Wi-Fi! (Even if Mobile Data is also ON)
    isAuthenticatingRef.current = true;
    setIsLoading(true);
    setNetwork('connecting');
    setStatusMessage({
      type: 'neutral',
      text: `Authenticating with CURAJ Wi-Fi (${env.ssid || 'CURAJ CAMPUS CONNECT'})...`,
    });

    try {
      let res;
      if (Platform.OS === 'android' && CampusConnectModule?.authenticateWifi) {
        res = await CampusConnectModule.authenticateWifi();
      } else {
        res = await loginToGateway(targetUser, targetPass);
      }

      if (res.success) {
        setNetwork('online');
        setStatusMessage({
          type: 'success',
          text: '✓ ' + res.message,
        });
        // Issue 3: Notify Android's ConnectivityService that the captive portal is
        // resolved. This clears the "Sign in required" notification bar entry on
        // phones where Android's own probe hasn't re-run yet.
        if (Platform.OS === 'android' && CampusConnectModule?.reportNetworkConnectivity) {
          CampusConnectModule.reportNetworkConnectivity().catch(() => {});
        }
      } else {
        if (res.isExternal) {
          setNetwork('external');
        } else if (res.isUnreachable) {
          // Gateway timed out entirely — WiFi up but internet is down (Issue 2)
          setNetwork('no_internet');
        } else {
          setNetwork('login_needed');
        }
        setStatusMessage({
          type: 'error',
          text: '⚠ ' + res.message,
        });
      }
    } finally {
      setIsLoading(false);
      isAuthenticatingRef.current = false;
    }
  }, [detectEnvironment]);

  // 1. Startup trigger: load credentials & verify exact network environment
  // Run both in parallel — credentials come from local AsyncStorage (fast) and
  // should NOT wait on slow network probes (NAS/internet timeouts).
  useEffect(() => {
    (async () => {
      const [env, creds] = await Promise.all([detectEnvironment(), getCredentials()]);

      if (creds && creds.username && creds.password) {
        setUsername(creds.username);
        setPassword(creds.password);
        setIsRegistered(true);

        if (Platform.OS === 'android' && CampusConnectModule?.startBackgroundService) {
          CampusConnectModule.startBackgroundService(creds.username, creds.password).catch(() => { });
        }

        if (env.type === 'curaj_wifi') {
          await runAutoLogin(creds.username, creds.password, 'startup');
        } else if (env.type === 'offline') {
          setNetwork('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Turn on Wi-Fi to connect.',
          });
        } else if (env.type === 'cellular') {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Auto-login runs on CURAJ Wi-Fi.',
          });
        } else {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: `Connected to external Wi-Fi ("${env.ssid}").`,
          });
        }
      } else {
        // No saved credentials — Issue 1: never show 'online' to an unregistered user.
        // Even if the device has internet on CURAJ WiFi (e.g. from a previous browser
        // session), the app has done nothing — show 'unregistered' to prompt setup.
        if (env.type === 'curaj_wifi') {
          setNetwork('unregistered');
          setStatusMessage({
            type: 'neutral',
            text: `● ${env.ssid || 'CURAJ Wi-Fi'} detected. Enter your credentials and tap Register to enable auto-login.`,
          });
        } else if (env.type === 'offline') {
          setNetwork('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Enter credentials once Wi-Fi is available.',
          });
        } else if (env.type === 'cellular') {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Enter credentials to enable auto-login.',
          });
        } else {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: `Connected to external Wi-Fi ("${env.ssid}").`,
          });
        }
      }
    })();
  }, [detectEnvironment, runAutoLogin]);

  // 2. Network state trigger: reacts immediately to Wi-Fi/data switches
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(() => {
      detectEnvironment().then(env => {
        if (env.type === 'offline') {
          setNetwork('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Turn on Wi-Fi to connect.',
          });
        } else if (env.type === 'curaj_wifi') {
          if (env.isOnline) {
            // Only show 'online' if credentials are registered. An unregistered user
            // on CURAJ WiFi with existing internet must not see the success state.
            if (isRegisteredRef.current) {
              setNetwork('online');
              setStatusMessage({
                type: 'success',
                text: `✓ Connected to ${env.ssid} with active internet.`,
              });
            } else {
              setNetwork('unregistered');
              setStatusMessage({
                type: 'neutral',
                text: `● ${env.ssid || 'CURAJ Wi-Fi'} detected. Enter your credentials and tap Register to enable auto-login.`,
              });
            }
          } else {
            setNetwork('login_needed');
            setStatusMessage({
              type: 'neutral',
              text: `● ${env.ssid} detected. Gateway login needed.`,
            });
            getCredentials().then(creds => {
              if (creds && creds.username && creds.password) {
                runAutoLogin(creds.username, creds.password, 'wifi-connected');
              }
            });
          }
        } else if (env.type === 'cellular') {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Auto-login is active on CURAJ Wi-Fi.',
          });
        } else {
          setNetwork('external');
          setStatusMessage({
            type: 'neutral',
            text: `Connected to external Wi-Fi ("${env.ssid}").`,
          });
        }
      });
    });
    return () => unsubscribe();
  }, [detectEnvironment, runAutoLogin]);

  // 3. App resume trigger: checks status when user unlocks or reopens app
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        detectEnvironment().then(env => {
          if (env.type === 'offline') {
            setNetwork('offline');
          } else if (env.type === 'curaj_wifi') {
            if (env.isOnline) {
              // Guard: only 'online' if registered
              if (isRegisteredRef.current) {
                setNetwork('online');
              } else {
                setNetwork('unregistered');
              }
            } else {
              setNetwork('login_needed');
              getCredentials().then(creds => {
                if (creds && creds.username && creds.password) {
                  runAutoLogin(creds.username, creds.password, 'app-resume');
                }
              });
            }
          } else {
            setNetwork('external');
          }
        });
      }
    });
    return () => sub.remove();
  }, [detectEnvironment, runAutoLogin]);

  // Ref to throttle watchdog retries when internet is completely down (Issue 2).
  // Avoids hammering the gateway every 5s when it's already confirmed unreachable.
  const lastNoInternetCheckRef = useRef(0);

  // 4. Continuous Watchdog Macro: checks every 5 seconds without failing on dual networks
  useEffect(() => {
    const timer = setInterval(() => {
      if (isAuthenticatingRef.current) return;

      // Issue 2: When internet is fully down, slow retries to every 30s.
      if (networkStateRef.current === 'no_internet') {
        const now = Date.now();
        if (now - lastNoInternetCheckRef.current < 30000) return;
        lastNoInternetCheckRef.current = now;
      }

      detectEnvironment().then(env => {
        if (env.type === 'offline') {
          setNetwork('offline');
          return;
        }
        if (env.type === 'cellular') {
          setNetwork('external');
          return;
        }
        if (env.type === 'external_wifi') {
          setNetwork('external');
          return;
        }
        if (env.type === 'curaj_wifi') {
          if (env.isOnline) {
            // Guard: only mark 'online' if user has registered credentials
            if (isRegisteredRef.current) {
              setNetwork('online');
            } else {
              setNetwork('unregistered');
            }
          } else {
            getCredentials().then(creds => {
              if (creds && creds.username && creds.password) {
                // Registered user — attempt login; runAutoLogin will set no_internet
                // if gateway is unreachable.
                runAutoLogin(creds.username, creds.password, 'watchdog');
              } else {
                // Unregistered user — just flag as unregistered, not login_needed
                setNetwork('unregistered');
              }
            });
          }
        }
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [detectEnvironment, runAutoLogin]);

  // Handle username input with informative feedback
  const handleUsernameChange = (val) => {
    const cleaned = val.replace(/[^0-9]/g, '').slice(0, 10);
    setUsername(cleaned);
    if (val && cleaned !== val) {
      setStatusMessage({
        type: 'neutral',
        text: 'Note: CURAJ Wi-Fi username is your 10-digit mobile number.',
      });
    }
  };

  // Status pill tap handler - provides active feedback and re-tests connectivity accurately
  const handleStatusPillPress = async () => {
    setStatusMessage({
      type: 'neutral',
      text: 'Checking connection & Wi-Fi environment...',
    });
    setIsLoading(true);
    try {
      const env = await detectEnvironment();

      if (env.type === 'offline') {
        setNetwork('offline');
        setStatusMessage({
          type: 'neutral',
          text: 'Device is offline. Please turn on Wi-Fi or mobile data.',
        });
        return;
      }

      if (env.type === 'curaj_wifi') {
        if (env.isOnline) {
          // Guard: status pill must also respect registration state
          if (isRegisteredRef.current) {
            setNetwork('online');
            setStatusMessage({
              type: 'success',
              text: `✓ Connected to ${env.ssid} with active internet.`,
            });
          } else {
            setNetwork('unregistered');
            setStatusMessage({
              type: 'neutral',
              text: `● ${env.ssid || 'CURAJ Wi-Fi'} detected. Enter your credentials and tap Register to enable auto-login.`,
            });
          }
        } else {
          setNetwork('login_needed');
          setStatusMessage({
            type: 'neutral',
            text: `● ${env.ssid} connected. Gateway login needed.`,
          });
        }
        return;
      }

      if (env.type === 'cellular') {
        setNetwork('external');
        setStatusMessage({
          type: 'neutral',
          text: env.isOnline
            ? 'Connected via mobile data (Internet active). Connect to CURAJ Wi-Fi for campus auto-login.'
            : 'Mobile data connected, but no internet access detected.',
        });
        return;
      }

      if (env.type === 'external_wifi') {
        setNetwork('external');
        setStatusMessage({
          type: 'neutral',
          text: `Connected to external Wi-Fi ("${env.ssid}"). Connect to CURAJ Wi-Fi for campus auto-login.`,
        });
        return;
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Register credentials and run initial connection
  const handleRegister = async () => {
    if (!username || username.trim().length === 0) {
      setStatusMessage({
        type: 'error',
        text: '⚠ Please enter your 10-digit mobile number.',
      });
      Alert.alert('Mobile Number Required', 'Please enter your 10-digit mobile number registered with CURAJ Wi-Fi.');
      return;
    }
    if (username.length < 10) {
      setStatusMessage({
        type: 'error',
        text: '⚠ Phone number must be exactly 10 digits.',
      });
      Alert.alert('Incomplete Phone Number', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!password || password.trim().length === 0) {
      setStatusMessage({
        type: 'error',
        text: '⚠ Please enter your Wi-Fi password.',
      });
      Alert.alert('Missing Password', 'Please enter your CURAJ Wi-Fi password.');
      return;
    }

    // Save locally
    await saveCredentials(username, password);
    // NOTE: setIsRegistered(true) is intentionally called AFTER runAutoLogin completes.
    // Calling it before would flip the button label to "Update & Reconnect" before the
    // loading spinner starts, causing a jarring flash. Credentials are already on disk.

    // Start native 24/7 background service
    if (Platform.OS === 'android' && CampusConnectModule?.startBackgroundService) {
      CampusConnectModule.startBackgroundService(username, password).catch(() => { });
    }

    setStatusMessage({
      type: 'neutral',
      text: 'Credentials registered. Initiating connection...',
    });

    // Run auto-login immediately — button stays "Register Auto-Login" + spinner during this
    await runAutoLogin(username, password, 'manual-register');

    // Only flip to registered state after the login attempt resolves
    setIsRegistered(true);
  };

  // Manual sync / test connection
  const handleTestConnection = async () => {
    if (!username || !password) {
      setStatusMessage({
        type: 'error',
        text: '⚠ Please enter both mobile number and password first.',
      });
      Alert.alert('Credentials Required', 'Please enter your mobile number and password before testing the connection.');
      return;
    }
    setStatusMessage({
      type: 'neutral',
      text: 'Testing gateway connection...',
    });
    await runAutoLogin(username, password, 'manual-sync');
  };

  // Deregister: clean up all saved data with full touch responsiveness
  const handleDeregister = async () => {
    if (!isRegistered && !username && !password) {
      setStatusMessage({
        type: 'neutral',
        text: 'No saved credentials found on this device.',
      });
      Alert.alert('No Saved Data', 'There are no saved credentials to remove on this device.');
      return;
    }

    Alert.alert(
      'Deregister Device',
      'This will remove your saved credentials from this device and stop the background service.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deregister',
          style: 'destructive',
          onPress: async () => {
            await clearCredentials();
            if (Platform.OS === 'android' && CampusConnectModule?.stopBackgroundService) {
              CampusConnectModule.stopBackgroundService().catch(() => { });
            }
            setUsername('');
            setPassword('');
            setIsRegistered(false);
            setStatusMessage({
              type: 'neutral',
              text: 'Credentials removed. Auto-login is disabled.',
            });
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {/* Header Panel with Dynamic Safe Area Top Inset */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 0) + 12,
          },
        ]}
      >
        <View style={styles.brandRow}>
          <View style={styles.terracottaDot} />
          <View style={styles.brandTextCol}>
            <Text style={styles.brandTitle} numberOfLines={1}>
              campus.connect
            </Text>
            <Text style={styles.brandSub} numberOfLines={1}>
              Central University of Rajasthan
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.statusPill,
            isLoading
              ? styles.statusPillConnecting
              : networkState === 'online'
                ? styles.statusPillOnline
                : networkState === 'external'
                  ? styles.statusPillExternal
                  : networkState === 'login_needed'
                    ? styles.statusPillLoginNeeded
                    : networkState === 'no_internet'
                      ? styles.statusPillNoInternet
                      : networkState === 'unregistered'
                        ? styles.statusPillUnregistered
                        : styles.statusPillOffline,
          ]}
          onPress={handleStatusPillPress}
          disabled={isLoading}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text
            style={[
              styles.statusPillText,
              isLoading
                ? styles.statusPillTextConnecting
                : networkState === 'online'
                  ? styles.statusPillTextOnline
                  : networkState === 'external'
                    ? styles.statusPillTextExternal
                    : networkState === 'login_needed'
                      ? styles.statusPillTextLoginNeeded
                      : networkState === 'no_internet'
                        ? styles.statusPillTextNoInternet
                        : networkState === 'unregistered'
                          ? styles.statusPillTextUnregistered
                          : styles.statusPillTextOffline,
            ]}
          >
            {isLoading
              ? '⚡ CONNECTING'
              : networkState === 'online'
                ? '● ONLINE'
                : networkState === 'external'
                  ? '● EXTERNAL'
                  : networkState === 'login_needed'
                    ? '● LOGIN NEEDED'
                    : networkState === 'no_internet'
                      ? '○ NO INTERNET'
                      : networkState === 'unregistered'
                        ? '● NOT REGISTERED'
                        : networkState === 'offline'
                          ? '○ OFFLINE'
                          : '○ CHECKING'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Body Container */}
          <View style={styles.container}>
            <View style={styles.mainContent}>
              {/* Section 01: Credentials */}
              <Text style={styles.sectionLabel}>01 • CREDENTIALS</Text>
              <View style={styles.card}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>MOBILE NUMBER (USERNAME)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 9876543210"
                    placeholderTextColor={colors.faint}
                    value={username}
                    onChangeText={handleUsernameChange}
                    keyboardType="phone-pad"
                    maxLength={10}
                    editable={!isLoading}
                  />
                </View>

                <View style={[styles.fieldGroup, { marginTop: 18 }]}>
                  <View style={styles.passwordLabelRow}>
                    <Text style={styles.fieldLabel}>WI-FI PASSWORD</Text>
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.toggleText}>
                        {showPassword ? 'HIDE' : 'SHOW'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter Wi-Fi password"
                    placeholderTextColor={colors.faint}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Section 02: Actions */}
              <Text style={styles.sectionLabel}>02 • SETUP & CONTROLS</Text>

              <TouchableOpacity
                style={[styles.primaryButton, isLoading && { opacity: 0.7 }]}
                onPress={handleRegister}
                disabled={isLoading}
                activeOpacity={0.85}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isRegistered ? 'Update & Reconnect' : 'Register Auto-Login'}
                  </Text>
                )}
              </TouchableOpacity>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleTestConnection}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>Test Connection</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={handleDeregister}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: isRegistered ? colors.text : colors.muted },
                    ]}
                  >
                    Deregister
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Live Feedback Card */}
              <View
                style={[
                  styles.feedbackCard,
                  statusMessage.type === 'success' && styles.feedbackSuccess,
                  statusMessage.type === 'error' && styles.feedbackError,
                ]}
              >
                <Text
                  style={[
                    styles.feedbackText,
                    statusMessage.type === 'success' && styles.feedbackTextSuccess,
                    statusMessage.type === 'error' && styles.feedbackTextError,
                  ]}
                >
                  {statusMessage.text}
                </Text>
              </View>
            </View>

            {/* Editorial Footer (Pinned to bottom) */}
            <View style={styles.footer}>
              {/* Sponsor Callout */}
              <View style={styles.sponsorRow}>
                <Text style={styles.sponsorText}>
                  If you want this app to keep running, you can{' '}
                </Text>
                <TouchableOpacity
                  style={styles.sponsorBtn}
                  onPress={() => Linking.openURL('https://nitinyadav.xyz/campus-connect/support')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sponsorHeart}>♥</Text>
                  <Text style={styles.sponsorBtnText}>Sponsor</Text>
                </TouchableOpacity>
                <Text style={styles.sponsorText}> to support us.</Text>
              </View>

              {/* Separator between Sponsor & Footer */}
              <View style={styles.footerDivider} />

              <Text style={styles.footerText}>
                100% Client-Side & Local • Zero Telemetry • Open Source
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://nitinyadav.xyz/campus-connect/privacy')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginTop: 5 }}
              >
                <Text style={[styles.footerText, { color: colors.muted, textDecorationLine: 'underline' }]}>
                  Privacy Policy
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Issue 2: Full-screen blocking overlay — WiFi connected but internet is completely down.
          Disables all buttons implicitly (sits above them), shows clear diagnosis,
          and offers a single Retry action. Tap retry re-runs status pill check. */}
      {networkState === 'no_internet' && (
        <View style={styles.noInternetOverlay}>
          <View style={styles.noInternetCard}>
            <Text style={styles.noInternetIcon}>📡</Text>
            <Text style={styles.noInternetTitle}>No Internet Access</Text>
            <Text style={styles.noInternetBody}>
              {'CURAJ Wi-Fi is connected but the campus gateway has no internet.\nThis usually means the ISP link or gateway server is temporarily down.'}
            </Text>
            <TouchableOpacity
              style={styles.noInternetRetryBtn}
              onPress={handleStatusPillPress}
              activeOpacity={0.8}
            >
              <Text style={styles.noInternetRetryText}>Retry Check</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  terracottaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    marginRight: 12,
  },
  brandTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  brandTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 16.5,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
    includeFontPadding: false,
  },
  brandSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    includeFontPadding: false,
  },
  statusPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    flexShrink: 0,
  },
  statusPillOnline: {
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  statusPillExternal: {
    backgroundColor: '#121d28',
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  statusPillLoginNeeded: {
    backgroundColor: '#3d1c14',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  statusPillConnecting: {
    backgroundColor: '#2b221a',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  statusPillOffline: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Issue 2: no internet — amber/orange warning tone
  statusPillNoInternet: {
    backgroundColor: '#2a1f0a',
    borderWidth: 1,
    borderColor: '#b45309',
  },
  // Issue 1: unregistered — neutral blue-grey, distinct from green 'online'
  statusPillUnregistered: {
    backgroundColor: '#141e2a',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusPillTextOnline: {
    color: colors.green,
  },
  statusPillTextExternal: {
    color: '#60a5fa',
  },
  statusPillTextLoginNeeded: {
    color: '#ffffff',
  },
  statusPillTextConnecting: {
    color: colors.accent,
  },
  statusPillTextOffline: {
    color: colors.muted,
  },
  statusPillTextNoInternet: {
    color: '#f59e0b',
  },
  statusPillTextUnregistered: {
    color: '#93c5fd',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    justifyContent: 'space-between',
  },
  mainContent: {
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 24,
  },
  fieldGroup: {},
  fieldLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.muted,
    marginBottom: 8,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  toggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    minHeight: 56,
  },
  feedbackSuccess: {
    backgroundColor: colors.greenBg,
    borderColor: colors.greenBorder,
  },
  feedbackError: {
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
  },
  feedbackText: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  feedbackTextSuccess: {
    color: colors.green,
  },
  feedbackTextError: {
    color: colors.red,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
  },
  sponsorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  footerDivider: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
  sponsorText: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 22,
    textAlign: 'center',
  },
  sponsorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#ea4aaa',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginHorizontal: 4,
  },
  sponsorHeart: {
    color: '#ea4aaa',
    fontSize: 10,
    marginRight: 4,
  },
  sponsorBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: -0.2,
  },
  footerText: {
    fontSize: 10.5,
    color: colors.faint,
    letterSpacing: 0.3,
  },

  // Issue 2: Full-screen blocking overlay styles
  noInternetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 10, 9, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 100,
  },
  noInternetCard: {
    backgroundColor: '#1a1612',
    borderWidth: 1,
    borderColor: '#b45309',
    borderRadius: 8,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  noInternetIcon: {
    fontSize: 36,
    marginBottom: 14,
  },
  noInternetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f59e0b',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  noInternetBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  noInternetRetryBtn: {
    backgroundColor: '#92400e',
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  noInternetRetryText: {
    color: '#fde68a',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

