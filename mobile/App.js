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
  const [networkState, setNetworkState] = useState('checking'); // 'online', 'external', 'login_needed', 'offline', 'checking'
  const [statusMessage, setStatusMessage] = useState({
    type: 'neutral', // 'success', 'error', 'neutral'
    text: 'Initializing Campus Connect...',
  });

  const isAuthenticatingRef = useRef(false);
  const usernameRef = useRef(username);
  const passwordRef = useRef(password);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

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
      setNetworkState('offline');
      setStatusMessage({
        type: 'error',
        text: '⚠ Device is offline. Please turn on Wi-Fi.',
      });
      return;
    }

    if (env.type === 'cellular') {
      setNetworkState('external');
      setStatusMessage({
        type: 'neutral',
        text: 'Connected via mobile data. Campus auto-login requires CURAJ Wi-Fi.',
      });
      return;
    }

    if (env.type === 'external_wifi') {
      setNetworkState('external');
      setStatusMessage({
        type: 'neutral',
        text: `Connected to "${env.ssid}". CURAJ auto-login is active on campus Wi-Fi.`,
      });
      return;
    }

    // We are on CURAJ campus Wi-Fi! (Even if Mobile Data is also ON)
    isAuthenticatingRef.current = true;
    setIsLoading(true);
    setNetworkState('connecting');
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
        setNetworkState('online');
        setStatusMessage({
          type: 'success',
          text: '✓ ' + res.message,
        });
      } else {
        if (res.isExternal) {
          setNetworkState('external');
        } else if (res.isUnreachable) {
          setNetworkState('offline');
        } else {
          setNetworkState('login_needed');
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
  useEffect(() => {
    (async () => {
      const env = await detectEnvironment();
      const creds = await getCredentials();

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
          setNetworkState('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Turn on Wi-Fi to connect.',
          });
        } else if (env.type === 'cellular') {
          setNetworkState('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Auto-login runs on CURAJ Wi-Fi.',
          });
        } else {
          setNetworkState('external');
          setStatusMessage({
            type: 'neutral',
            text: `Connected to external Wi-Fi ("${env.ssid}").`,
          });
        }
      } else {
        // No saved credentials
        if (env.type === 'curaj_wifi') {
          setNetworkState(env.isOnline ? 'online' : 'login_needed');
          setStatusMessage({
            type: env.isOnline ? 'success' : 'neutral',
            text: env.isOnline
              ? `✓ Connected to ${env.ssid}.`
              : `● ${env.ssid} detected. Enter credentials to login.`,
          });
        } else if (env.type === 'offline') {
          setNetworkState('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Enter credentials once Wi-Fi is available.',
          });
        } else if (env.type === 'cellular') {
          setNetworkState('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Enter credentials to enable auto-login.',
          });
        } else {
          setNetworkState('external');
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
          setNetworkState('offline');
          setStatusMessage({
            type: 'neutral',
            text: 'Device is offline. Turn on Wi-Fi to connect.',
          });
        } else if (env.type === 'curaj_wifi') {
          if (env.isOnline) {
            setNetworkState('online');
            setStatusMessage({
              type: 'success',
              text: `✓ Connected to ${env.ssid} with active internet.`,
            });
          } else {
            setNetworkState('login_needed');
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
          setNetworkState('external');
          setStatusMessage({
            type: 'neutral',
            text: 'Connected via mobile data. Auto-login is active on CURAJ Wi-Fi.',
          });
        } else {
          setNetworkState('external');
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
            setNetworkState('offline');
          } else if (env.type === 'curaj_wifi') {
            if (env.isOnline) {
              setNetworkState('online');
            } else {
              setNetworkState('login_needed');
              getCredentials().then(creds => {
                if (creds && creds.username && creds.password) {
                  runAutoLogin(creds.username, creds.password, 'app-resume');
                }
              });
            }
          } else {
            setNetworkState('external');
          }
        });
      }
    });
    return () => sub.remove();
  }, [detectEnvironment, runAutoLogin]);

  // 4. Continuous Watchdog Macro: checks every 5 seconds without failing on dual networks
  useEffect(() => {
    const timer = setInterval(() => {
      if (isAuthenticatingRef.current) return;
      detectEnvironment().then(env => {
        if (env.type === 'offline') {
          setNetworkState('offline');
          return;
        }
        if (env.type === 'cellular') {
          setNetworkState('external');
          return;
        }
        if (env.type === 'external_wifi') {
          setNetworkState('external');
          return;
        }
        if (env.type === 'curaj_wifi') {
          if (env.isOnline) {
            setNetworkState('online');
          } else {
            setNetworkState('login_needed');
            getCredentials().then(creds => {
              if (creds && creds.username && creds.password) {
                runAutoLogin(creds.username, creds.password, 'watchdog');
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
        setNetworkState('offline');
        setStatusMessage({
          type: 'neutral',
          text: 'Device is offline. Please turn on Wi-Fi or mobile data.',
        });
        return;
      }

      if (env.type === 'curaj_wifi') {
        if (env.isOnline) {
          setNetworkState('online');
          setStatusMessage({
            type: 'success',
            text: `✓ Connected to ${env.ssid} with active internet.`,
          });
        } else {
          setNetworkState('login_needed');
          setStatusMessage({
            type: 'neutral',
            text: `● ${env.ssid} connected. Gateway login needed.`,
          });
        }
        return;
      }

      if (env.type === 'cellular') {
        setNetworkState('external');
        setStatusMessage({
          type: 'neutral',
          text: env.isOnline
            ? 'Connected via mobile data (Internet active). Connect to CURAJ Wi-Fi for campus auto-login.'
            : 'Mobile data connected, but no internet access detected.',
        });
        return;
      }

      if (env.type === 'external_wifi') {
        setNetworkState('external');
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
    setIsRegistered(true);

    // Start native 24/7 background service
    if (Platform.OS === 'android' && CampusConnectModule?.startBackgroundService) {
      CampusConnectModule.startBackgroundService(username, password).catch(() => { });
    }

    setStatusMessage({
      type: 'neutral',
      text: 'Credentials registered. Initiating connection...',
    });

    // Run auto-login immediately
    await runAutoLogin(username, password, 'manual-register');
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
});
