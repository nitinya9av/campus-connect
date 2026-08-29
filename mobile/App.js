import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './src/styles/theme';
import { saveCredentials, getCredentials, clearCredentials } from './src/storage/credentials';
import { loginToGateway, checkInternetAccess, isGatewayReachable } from './src/api/gateway';

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
  const [statusMessage, setStatusMessage] = useState({
    type: 'neutral', // 'success', 'error', 'neutral'
    text: 'Enter your credentials to configure automatic Wi-Fi login.',
  });

  // Load saved credentials on startup
  useEffect(() => {
    (async () => {
      const creds = await getCredentials();
      if (creds && creds.username) {
        setUsername(creds.username);
        setPassword(creds.password);
        setIsRegistered(true);
        setStatusMessage({
          type: 'success',
          text: '✓ Auto-login configured and saved on this device.',
        });
      }
    })();
  }, []);

  // Handle number input (strict 10 digits filter)
  const handleUsernameChange = (val) => {
    const cleaned = val.replace(/[^0-9]/g, '').slice(0, 10);
    setUsername(cleaned);
  };

  // Register credentials and test login
  const handleRegister = async () => {
    if (!username || username.length < 10) {
      Alert.alert('Incomplete Phone Number', 'Please enter your 10-digit mobile number.');
      return;
    }
    if (!password) {
      Alert.alert('Missing Password', 'Please enter your Wi-Fi password.');
      return;
    }

    setIsLoading(true);
    setStatusMessage({ type: 'neutral', text: 'Connecting to CURAJ gateway...' });

    // Save locally
    await saveCredentials(username, password);
    setIsRegistered(true);

    // Attempt direct login
    const res = await loginToGateway(username, password);
    setIsLoading(false);

    if (res.success) {
      setStatusMessage({
        type: 'success',
        text: '✓ ' + res.message,
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: '⚠ Saved, but gateway returned: ' + res.message,
      });
    }
  };

  // Test connection manually
  const handleTestConnection = async () => {
    if (!username || !password) {
      Alert.alert('No Credentials', 'Please enter your credentials first.');
      return;
    }

    setIsLoading(true);
    setStatusMessage({ type: 'neutral', text: 'Testing connection to CURAJ gateway...' });

    const hasInternet = await checkInternetAccess(3000);
    if (hasInternet) {
      setIsLoading(false);
      setStatusMessage({
        type: 'success',
        text: '✓ Internet access is active and working.',
      });
      return;
    }

    const res = await loginToGateway(username, password);
    setIsLoading(false);

    if (res.success) {
      setStatusMessage({
        type: 'success',
        text: '✓ ' + res.message,
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: '✕ ' + res.message,
      });
    }
  };

  // Deregister: clean up all saved data
  const handleDeregister = async () => {
    Alert.alert(
      'Deregister Device',
      'This will remove your saved credentials from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deregister',
          style: 'destructive',
          onPress: async () => {
            await clearCredentials();
            setUsername('');
            setPassword('');
            setIsRegistered(false);
            setStatusMessage({
              type: 'neutral',
              text: 'Credentials removed. Auto-login is idle.',
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

        <View
          style={[
            styles.statusPill,
            isRegistered ? styles.statusPillActive : styles.statusPillIdle,
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              isRegistered ? styles.statusPillTextActive : styles.statusPillTextIdle,
            ]}
          >
            {isLoading ? '● CONNECTING' : isRegistered ? '● ACTIVE' : '○ IDLE'}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 32 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Body Container */}
          <View style={styles.container}>
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
                  keyboardType="numeric"
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
                disabled={isLoading || !isRegistered}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: isRegistered ? colors.muted : colors.faint },
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

            {/* Editorial Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                100% Client-Side & Local • Zero Telemetry • Open Source
              </Text>
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
    paddingBottom: 40,
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
  statusPillActive: {
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  statusPillIdle: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusPillTextActive: {
    color: colors.green,
  },
  statusPillTextIdle: {
    color: colors.muted,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
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
    marginTop: 12,
  },
  footerText: {
    fontSize: 10.5,
    color: colors.faint,
    letterSpacing: 0.3,
  },
});
