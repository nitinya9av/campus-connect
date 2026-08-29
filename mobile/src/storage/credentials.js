import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@curaj_campus_connect_creds';

export async function saveCredentials(username, password) {
  try {
    const data = JSON.stringify({ username, password, registeredAt: Date.now() });
    await AsyncStorage.setItem(STORAGE_KEY, data);
    return true;
  } catch (err) {
    console.error('Error saving credentials:', err);
    return false;
  }
}

export async function getCredentials() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading credentials:', err);
    return null;
  }
}

export async function clearCredentials() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (err) {
    console.error('Error clearing credentials:', err);
    return false;
  }
}
