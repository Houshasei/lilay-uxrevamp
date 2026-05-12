import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIVESIM_PROXY_URL, PLATFORMS, SHEETS, USERS } from './config.js';
import { buyInstagramNumber, cancelOrder as cancelFiveSimOrder, checkOrder, finishOrder, getPrices, getProfile } from './api/fivesim.js';
import { fetchSheet, getSheetUrl, preloadSheets, updateSecretInSheet } from './api/sheets.js';
import { cancelSMS, checkResend, checkSMS, getBalance as getSmspoolBalance, getHistory, getStock, orderSMS, resendSMS as resendSmspoolSMS } from './api/smspool.js';
import { copyToClipboard, readFromClipboard } from './utils/clipboard.js';
import { getStoredJson, getStoredValue, setStoredJson, setStoredValue } from './utils/storage.js';
import { generateTOTP, getTotpSecondsRemaining, isValidBase32, normalizeSecret } from './utils/totp.js';

const PROFILE_FIELDS = [
  { key: 'username', label: 'Username', aliases: ['username', 'Username'] },
  { key: 'igpassword', label: 'IG Password', aliases: ['igpassword', 'igPassword', 'IG Password'] },
  { key: 'location', label: 'Location', aliases: ['location', 'Location'] },
  { key: 'container', label: 'Container ID', aliases: ['container', 'Container', 'Container ID'] },
  { key: 'reel', label: 'Reel #', aliases: ['reel', 'Reel', 'Reel #'] },
  { key: 'name', label: 'Name', aliases: ['name', 'Name'] },
  { key: 'email', label: 'Email', aliases: ['email', 'Email'] },
  { key: 'password', label: 'Password', aliases: ['password', 'Password'] },
  { key: 'secret', label: 'Secret', aliases: ['secret', 'Secret'] },
];

const DAY_COLUMNS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getFirstValue(row, aliases, fallback = '-') {
  for (const alias of aliases) {
    if (row?.[alias] !== undefined && row[alias] !== null && row[alias] !== '') return row[alias];
  }
  return fallback;
}

function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredValue('currentUser', 'Ces'));
  const [currentPlatform, setCurrentPlatform] = useState(() => getStoredValue('currentPlatform', 'Instagram'));
  const [sheetCache, setSheetCache] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [currentProfile, setCurrentProfile] = useState(() => Number.parseInt(getStoredValue('lastProfileIndex', '0'), 10) || 0);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState({ message: '', type: '' });
  const [activeModal, setActiveModal] = useState(null);
  const [modalRows, setModalRows] = useState([]);
  const [totpSecret, setTotpSecret] = useState('');
  const [manualTotp, setManualTotp] = useState('-');
  const [manualTimer, setManualTimer] = useState('-');
  const [profileOtp, setProfileOtp] = useState('-');
  const [profileOtpTimer, setProfileOtpTimer] = useState('-');
  const [smsProvider, setSmsProvider] = useState(() => getStoredValue('smsProvider', 'smspool'));
  const [apiKey, setApiKey] = useState(() => getStoredValue(`${getStoredValue('smsProvider', 'smspool')}_api_key`, ''));
  const [apiLocked, setApiLocked] = useState(() => getStoredValue('apiKeyLocked', 'false') === 'true');
  const [balanceText, setBalanceText] = useState('Balance: Loading...');
  const [stockText, setStockText] = useState('Instagram (USA) numbers: Loading...');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [currentOrderId, setCurrentOrderId] = useState(null);
  const [ordering, setOrdering] = useState(false);
  const [resending, setResending] = useState(false);
  const [collapsed, setCollapsed] = useState(() => ({
    tfa: getStoredValue('tfaMinimized', 'false') === 'true',
    sms: getStoredValue('smsMinimized', 'false') === 'true',
  }));
  const [located, setLocated] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ user: currentUser, platform: currentPlatform });

  const cacheRef = useRef({});
  const pollingRef = useRef(null);
  const balanceRef = useRef(null);
  const profileOtpRef = useRef(null);
  const manualTotpRef = useRef(null);
  const toastRef = useRef(null);
  const pickedPostIndexes = useRef(getStoredJson('pickedPostIndexes', {}));
  const lastFollowed = useRef([]);
  const followCopyCount = useRef(0);

  const sheetUrl = useMemo(() => getSheetUrl(currentUser), [currentUser]);
  const currentProfileData = profiles[currentProfile] || {};
  const followData = sheetCache.Follow || [];

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2500);
  }, []);

  const updateStatus = useCallback((message, type = '') => {
    setStatus({ message, type });
  }, []);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const runContainerShortcut = useCallback((container = getFirstValue(currentProfileData, ['container', 'Container', 'Container ID'], '')) => {
    const containerNumber = Number.parseInt(container, 10);
    if (!containerNumber) return;
    window.location.href = `shortcuts://run-shortcut?name=${currentPlatform}${containerNumber}`;
  }, [currentPlatform, currentProfileData]);

  const loadSheets = useCallback(async () => {
    setLoadingSheets(true);
    showToast('Refreshing data...');
    try {
      cacheRef.current = {};
      const cache = await preloadSheets(sheetUrl, SHEETS);
      cacheRef.current = cache;
      setSheetCache(cache);
      const nextProfiles = cache.Accounts || [];
      setProfiles(nextProfiles);
      const savedIndex = Number.parseInt(getStoredValue('lastProfileIndex', '0'), 10) || 0;
      const normalizedIndex = nextProfiles.length ? ((savedIndex % nextProfiles.length) + nextProfiles.length) % nextProfiles.length : 0;
      setCurrentProfile(normalizedIndex);
      setStoredValue('lastProfileIndex', normalizedIndex);
      showToast('Sheets refreshed!');
    } catch {
      showToast('Refresh failed');
    } finally {
      setLoadingSheets(false);
    }
  }, [sheetUrl, showToast]);

  const getCachedSheet = useCallback(async (sheetName) => {
    const data = await fetchSheet(sheetUrl, sheetName, cacheRef.current);
    setSheetCache({ ...cacheRef.current });
    return data;
  }, [sheetUrl]);

  const changeProfile = useCallback((nextIndex) => {
    if (!profiles.length) return;
    const normalized = ((nextIndex % profiles.length) + profiles.length) % profiles.length;
    setCurrentProfile(normalized);
    setStoredValue('lastProfileIndex', normalized);
    setLocated(false);
  }, [profiles.length]);

  const copyValue = useCallback(async (label, value) => {
    const ok = await copyToClipboard(value || '-');
    showToast(ok ? `${label} copied!` : 'Copy failed. Please copy manually.');
  }, [showToast]);

  const copyLocationAndSwitchVpn = async () => {
    await copyValue('Location', getFirstValue(currentProfileData, ['location', 'Location'], '-'));
    window.location.href = 'shortcuts://run-shortcut?name=SwitchEXP';
  };

  const openPlatform = useCallback(() => {
    window.open(currentPlatform === 'Instagram' ? 'https://www.instagram.com/' : 'https://www.threads.com/', '_blank');
  }, [currentPlatform]);

  const pickRandom = async (sheetName) => {
    try {
      showToast(`Copying from ${sheetName}...`);
      const data = await getCachedSheet(sheetName);
      const choice = data[Math.floor(Math.random() * data.length)];
      const location = getFirstValue(currentProfileData, ['Location', 'location'], '');
      const value = String(Object.values(choice || {})[0] || '').replace(/\(loc\)/gi, location);
      await copyToClipboard(value);
      showToast(`${sheetName} copied!`);
      openPlatform();
    } catch {
      showToast(`Failed to load ${sheetName}`);
    }
  };

  const pickTodayPost = async () => {
    try {
      showToast("Picking today's post...");
      const posts = await getCachedSheet('Posts');
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const today = days[new Date().getDay()];
      const username = getFirstValue(currentProfileData, ['username', 'Username'], 'unknown');
      const todayPosts = posts.map((row, index) => ({ index, text: row[today] })).filter((post) => post.text?.trim());
      if (!todayPosts.length) {
        showToast(`No posts found for ${today}`);
        return;
      }

      if (!pickedPostIndexes.current[username]) pickedPostIndexes.current[username] = {};
      if (!pickedPostIndexes.current[username][today]) pickedPostIndexes.current[username][today] = [];

      const used = pickedPostIndexes.current[username][today];
      let unused = todayPosts.filter((post) => !used.includes(post.index));
      if (!unused.length) {
        pickedPostIndexes.current[username][today] = [];
        unused = todayPosts;
        showToast('All posts used for this account, restarting pool');
      }

      const selected = unused[Math.floor(Math.random() * unused.length)];
      pickedPostIndexes.current[username][today].push(selected.index);
      setStoredJson('pickedPostIndexes', pickedPostIndexes.current);

      const location = getFirstValue(currentProfileData, ['location', 'Location'], '');
      await copyToClipboard(String(selected.text).replace(/\(loc\)/gi, location));
      showToast('Post copied with location!');
      openPlatform();
    } catch {
      showToast('Error picking post');
    }
  };

  const pickFollow = async () => {
    try {
      showToast('Picking follow...');
      const available = followData.filter((item) => !lastFollowed.current.includes(item));
      if (!followData.length) {
        showToast('No follow data available');
        return;
      }
      if (!available.length) {
        lastFollowed.current = [];
        return pickFollow();
      }
      const choice = available[Math.floor(Math.random() * available.length)];
      await copyToClipboard(Object.values(choice || {})[0] || '');
      lastFollowed.current.push(choice);
      followCopyCount.current += 1;
      if (followCopyCount.current >= 5) {
        lastFollowed.current = [];
        followCopyCount.current = 0;
      }
      showToast('Follow data copied!');
      openPlatform();
    } catch {
      showToast('Error picking follow');
    }
  };

  const openAccountsModal = async () => {
    try {
      setModalRows(await getCachedSheet('Accounts'));
      setActiveModal('accounts');
    } catch {
      showToast('Failed to load accounts');
    }
  };

  const openPostsModal = async () => {
    try {
      setModalRows(await getCachedSheet('Posts'));
      setActiveModal('posts');
    } catch {
      showToast('Failed to load posts');
    }
  };

  const searchLocation = () => {
    const location = getFirstValue(currentProfileData, ['location', 'Location'], '');
    if (!location) {
      showToast('Location not found for this profile.');
      return;
    }
    if (located) {
      window.open('https://www.threads.com/', '_blank');
      return;
    }
    setLocated(true);
    window.open(`https://www.threads.com/search?q=${encodeURIComponent(location)}&serp_type=default&hl=en`, '_blank');
  };

  const startManualTOTP = useCallback((secretValue = totpSecret) => {
    const secret = normalizeSecret(secretValue);
    if (!secret) {
      showToast('Please enter a secret');
      return;
    }
    if (!isValidBase32(secret)) {
      showToast('Invalid Base32 secret. Must consist of A-Z, 2-7, and = only.');
      return;
    }

    const update = async () => {
      try {
        setManualTotp(await generateTOTP(secret));
        setManualTimer(`(${getTotpSecondsRemaining()}s)`);
      } catch {
        showToast('Error generating TOTP');
      }
    };

    clearInterval(manualTotpRef.current);
    update();
    manualTotpRef.current = setInterval(update, 1000);
    showToast('TOTP generated and auto-refreshing');
  }, [showToast, totpSecret]);

  const resetManualTOTP = () => {
    clearInterval(manualTotpRef.current);
    manualTotpRef.current = null;
    setTotpSecret('');
    setManualTotp('-');
    setManualTimer('-');
  };

  const pasteSecret = async () => {
    try {
      const text = await readFromClipboard();
      setTotpSecret(text);
      showToast('Secret pasted!');
      setTimeout(() => startManualTOTP(text), 0);
    } catch {
      showToast('Failed to paste from clipboard');
    }
  };

  const writeSecretToSheet = async () => {
    const container = getFirstValue(currentProfileData, ['container', 'Container', 'Container ID'], '');
    if (!totpSecret.trim() || !container) {
      showToast('No secret or container to update');
      return;
    }
    try {
      const data = await updateSecretInSheet(sheetUrl, container, totpSecret.trim());
      showToast(data.success ? 'Key written in sheet!' : 'Writing failed');
      if (data.success) loadSheets();
    } catch {
      showToast('Writing error');
    }
  };

  const refreshBalance = useCallback(async () => {
    const key = apiKey.trim();
    if (!key) {
      setBalanceText('Balance: Enter key');
      setStockText('Available numbers: Enter key');
      return;
    }

    try {
      if (smsProvider === 'smspool') {
        const balance = await getSmspoolBalance(key);
        const balanceValue = Number.parseFloat(balance.balance);
        setBalanceText(balance.balance !== undefined ? `Balance: $${Number.isNaN(balanceValue) ? balance.balance : balanceValue.toFixed(2)}` : 'Balance: $0.00');
        const stock = await getStock(key);
        setStockText(stock?.success && stock.amount !== undefined ? `Instagram/Threads SMS available numbers: ${stock.amount}` : 'Instagram/Threads SMS available numbers: Error');
      } else {
        const profile = await getProfile(FIVESIM_PROXY_URL, key);
        setBalanceText(`Balance: $${Number.parseFloat(profile.balance || 0).toFixed(2)}`);
        const prices = await getPrices(FIVESIM_PROXY_URL);
        const totalStock = Object.values(prices?.usa?.instagram || {}).reduce((sum, operator) => sum + (operator.count || 0), 0);
        setStockText(`Instagram numbers: ${totalStock} available`);
      }
    } catch {
      setBalanceText('Balance: Error');
      setStockText('Available numbers: Error');
    }
  }, [apiKey, smsProvider]);

  const getNumber = async () => {
    const key = apiKey.trim();
    if (!key) {
      updateStatus('Please enter your API key', 'error');
      return;
    }

    clearPolling();
    setOrdering(true);
    setPhoneNumber('');
    setSmsCode('');
    updateStatus('Ordering SMS...', 'loading');

    try {
      if (smsProvider === 'smspool') {
        const order = await orderSMS(key);
        if (!order.success) throw new Error(order.message || 'Failed to order SMS');
        setCurrentOrderId(order.order_id);
        setPhoneNumber(order.phonenumber);
        updateStatus('Preparing number...', 'loading');

        let attempts = 0;
        pollingRef.current = setInterval(async () => {
          attempts += 1;
          updateStatus(`Waiting for SMS... (attempt ${attempts})`, 'loading');
          try {
            const smsCheck = await checkSMS(key, order.order_id);
            if (smsCheck?.status === 8) updateStatus('Activating number... Please wait before sending SMS', 'loading');
            if (smsCheck?.status === 1) updateStatus('Number is ready. Waiting for SMS...', 'loading');
            if (smsCheck?.sms) {
              clearPolling();
              setSmsCode(smsCheck.sms);
              setCurrentOrderId(null);
              updateStatus('SMS received!', 'success');
              setOrdering(false);
            }
          } catch {
          }
        }, 5000);
      } else {
        const order = await buyInstagramNumber(FIVESIM_PROXY_URL, key);
        if (!order?.id) throw new Error(`Failed to buy number: ${order?.message || order?.error || 'Unknown error'}`);
        setCurrentOrderId(order.id);
        setPhoneNumber(order.phone);
        updateStatus('Number bought! Polling for SMS...', 'loading');

        pollingRef.current = setInterval(async () => {
          try {
            const data = await checkOrder(FIVESIM_PROXY_URL, key, order.id);
            if (data.sms?.length) {
              clearPolling();
              setSmsCode(data.sms[0].code || data.sms[0].text);
              setCurrentOrderId(null);
              updateStatus('SMS received!', 'success');
              setOrdering(false);
            } else if (data.status === 'CANCELED' || data.status === 'TIMEOUT') {
              clearPolling();
              updateStatus(`Order ended - ${data.status}`, 'error');
              setOrdering(false);
            }
          } catch {
          }
        }, 5000);
      }
    } catch (error) {
      updateStatus(error.message, 'error');
      setOrdering(false);
    }
  };

  const cancelOrder = async () => {
    if (!currentOrderId) {
      updateStatus('No active order to cancel', 'error');
      return;
    }
    const key = apiKey.trim();
    if (!key) {
      updateStatus('API key required', 'error');
      return;
    }

    try {
      if (smsProvider === '5sim') {
        await cancelFiveSimOrder(FIVESIM_PROXY_URL, key, currentOrderId);
      } else {
        const result = await cancelSMS(key, currentOrderId);
        if (!result.success) throw new Error(result.message || 'Failed to cancel');
      }
      clearPolling();
      setCurrentOrderId(null);
      setPhoneNumber('');
      setSmsCode('');
      setOrdering(false);
      updateStatus('Order cancelled successfully', 'success');
    } catch (error) {
      updateStatus(error.message, 'error');
    }
  };

  const resendSMS = async () => {
    if (smsProvider === '5sim') {
      updateStatus('Resend not supported on 5SIM yet', 'error');
      return;
    }
    const key = apiKey.trim();
    if (!key) {
      updateStatus('Please enter your API key', 'error');
      return;
    }
    if (resending) {
      showToast('Already searching...');
      return;
    }

    setResending(true);
    updateStatus('Fetching order history...', 'loading');
    try {
      const history = await getHistory(key);
      const recentHistory = history.slice(0, 50);
      updateStatus(`Checking ${recentHistory.length} recent orders...`, 'loading');

      for (let index = 0; index < recentHistory.length; index += 1) {
        const order = recentHistory[index];
        const orderCode = order.order_code || order.orderid;
        if (!orderCode) continue;
        updateStatus(`Checking order ${index + 1}/${recentHistory.length}...`, 'loading');

        try {
          const check = await checkResend(key, orderCode);
          if (check?.success === 1 && check.message === 'This phonenumber is available for resend!') {
            updateStatus('Found resendable number! Resending now...', 'loading');
            const result = await resendSmspoolSMS(key, orderCode);
            if (result.success) {
              setCurrentOrderId(orderCode);
              setPhoneNumber(order.number || order.phonenumber || 'Unknown');
              setSmsCode('');
              let attempts = 0;
              clearPolling();
              pollingRef.current = setInterval(async () => {
                attempts += 1;
                updateStatus(`Waiting for resent SMS... (attempt ${attempts})`, 'loading');
                try {
                  const smsCheck = await checkSMS(key, orderCode);
                  if (smsCheck?.sms) {
                    clearPolling();
                    setSmsCode(smsCheck.sms);
                    setCurrentOrderId(null);
                    updateStatus('SMS resent successfully!', 'success');
                  }
                } catch {
                }
              }, 5000);
              showToast(`✅ Resending to: ${order.number || order.phonenumber || 'Unknown'}`);
              return;
            }
          }
        } catch {
        }
      }
      throw new Error('No resendable number in the last 50 orders');
    } catch (error) {
      updateStatus(error.message, 'error');
      showToast(error.message);
    } finally {
      setResending(false);
    }
  };

  const resetSMS = async () => {
    if (smsProvider === '5sim' && currentOrderId && apiKey.trim()) {
      try {
        await finishOrder(FIVESIM_PROXY_URL, apiKey.trim(), currentOrderId);
      } catch {
      }
    }
    clearPolling();
    setCurrentOrderId(null);
    setPhoneNumber('');
    setSmsCode('');
    setOrdering(false);
    updateStatus('Reset complete', 'success');
  };

  const toggleSection = (sectionId) => {
    setCollapsed((previous) => {
      const next = { ...previous, [sectionId]: !previous[sectionId] };
      setStoredValue(`${sectionId}Minimized`, next[sectionId]);
      return next;
    });
  };

  const saveSettings = () => {
    const nextUser = settingsDraft.user;
    const nextPlatform = settingsDraft.platform;
    setCurrentUser(nextUser);
    setCurrentPlatform(nextPlatform);
    setStoredValue('currentUser', nextUser);
    setStoredValue('currentPlatform', nextPlatform);
    setActiveModal(null);
    showToast('Settings saved!');
  };

  useEffect(() => {
    loadSheets();
  }, [loadSheets]);

  useEffect(() => {
    cacheRef.current = sheetCache;
  }, [sheetCache]);

  useEffect(() => {
    const secret = normalizeSecret(getFirstValue(currentProfileData, ['secret', 'Secret'], ''));
    clearInterval(profileOtpRef.current);
    setProfileOtp('-');
    setProfileOtpTimer('-');

    if (!secret || !isValidBase32(secret)) return undefined;

    const update = async () => {
      try {
        setProfileOtp(await generateTOTP(secret));
        setProfileOtpTimer(`(${getTotpSecondsRemaining()}s)`);
      } catch {
        setProfileOtp('Error');
        setProfileOtpTimer('');
      }
    };

    update();
    profileOtpRef.current = setInterval(update, 1000);
    return () => clearInterval(profileOtpRef.current);
  }, [currentProfileData]);

  useEffect(() => {
    runContainerShortcut();
  }, [runContainerShortcut]);

  useEffect(() => {
    setStoredValue('smsProvider', smsProvider);
    setApiKey(getStoredValue(`${smsProvider}_api_key`, ''));
  }, [smsProvider]);

  useEffect(() => {
    setStoredValue(`${smsProvider}_api_key`, apiKey.trim());
  }, [apiKey, smsProvider]);

  useEffect(() => {
    refreshBalance();
    clearInterval(balanceRef.current);
    balanceRef.current = setInterval(refreshBalance, 60000);
    return () => clearInterval(balanceRef.current);
  }, [refreshBalance]);

  useEffect(() => {
    const savedScrollY = getStoredValue('scrollPosition', '0');
    if (savedScrollY) window.scrollTo(0, Number.parseInt(savedScrollY, 10));
    const onScroll = () => setStoredValue('scrollPosition', window.scrollY.toString());
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => () => {
    clearPolling();
    clearInterval(balanceRef.current);
    clearInterval(profileOtpRef.current);
    clearInterval(manualTotpRef.current);
    clearTimeout(toastRef.current);
  }, [clearPolling]);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Lilay Workbench</p>
          <h1>Profile Manager</h1>
          <p className="subtle">Mobile-first tools for account creation, 2FA, SMS, and posting workflows.</p>
        </div>
        <button className="icon-button" onClick={() => {
          setSettingsDraft({ user: currentUser, platform: currentPlatform });
          setActiveModal('settings');
        }}>⚙️ Settings</button>
      </section>

      <section className="quick-grid sticky-actions">
        <button onClick={() => changeProfile(currentProfile - 1)} disabled={loadingSheets}>⬅️ Prev</button>
        <button onClick={() => changeProfile(currentProfile + 1)} disabled={loadingSheets}>Next ➡️</button>
        <button onClick={() => changeProfile(0)} disabled={loadingSheets}>🔁 First</button>
        <button onClick={loadSheets} disabled={loadingSheets}>{loadingSheets ? 'Refreshing...' : '🔄 Refresh'}</button>
      </section>

      <section className="glass-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{currentUser} · {currentPlatform}</p>
            <h2>👤 Creation Tools</h2>
          </div>
          <span className="pill">{profiles.length ? `${currentProfile + 1}/${profiles.length}` : 'No profiles'}</span>
        </div>

        <div className="profile-list">
          {PROFILE_FIELDS.map(({ key, label, aliases }) => {
            const value = getFirstValue(currentProfileData, aliases);
            const canCopy = key !== 'reel';
            return (
              <div className="profile-row" key={key}>
                <span className="profile-label">{label}</span>
                <span className="profile-value">{value}</span>
                {canCopy && (
                  <button className="mini-button" onClick={() => key === 'location' ? copyLocationAndSwitchVpn() : copyValue(label, value)}>Copy</button>
                )}
              </div>
            );
          })}
          <div className="profile-row otp-row">
            <span className="profile-label">OTP</span>
            <span className="profile-value code-text">{profileOtp} <small>{profileOtpTimer}</small></span>
            <button className="mini-button" onClick={() => profileOtp === '-' || profileOtp === 'Error' ? showToast('No valid OTP available') : copyValue('OTP', profileOtp)}>Copy</button>
          </div>
        </div>
      </section>

      <section className="quick-grid">
        <button onClick={() => pickRandom('Caption')}>🖊 Pick Caption</button>
        <button onClick={pickTodayPost}>📅 Pick Post</button>
        <button onClick={() => pickRandom('Reply')}>💬 Pick Reply</button>
        <button onClick={() => pickRandom('Comments')}>💭 Pick Comment</button>
        <button onClick={openAccountsModal}>📄 Show Accounts</button>
        <button onClick={openPostsModal}>📝 Show Posts</button>
        <button onClick={pickFollow}>👥 Follow People</button>
        <button onClick={searchLocation}>📍 Search Location</button>
        <button onClick={() => runContainerShortcut()}>⚡ Run Container</button>
      </section>

      <section className="glass-card">
        <div className="section-heading">
          <h2>🔐 2FA Generator</h2>
          <button className="mini-button" onClick={() => toggleSection('tfa')}>{collapsed.tfa ? '+' : '−'}</button>
        </div>
        {!collapsed.tfa && (
          <div className="stack">
            <div className="input-with-button">
              <input value={totpSecret} onChange={(event) => setTotpSecret(event.target.value)} onPaste={() => setTimeout(() => startManualTOTP(), 100)} placeholder="Paste TOTP secret here" />
              <button onClick={pasteSecret}>Paste</button>
            </div>
            <div className="code-panel">
              <span>{manualTotp}</span>
              <small>{manualTimer}</small>
              <button className="mini-button" onClick={() => manualTotp === '-' ? showToast('No TOTP generated') : copyValue('TOTP', manualTotp)}>Copy</button>
            </div>
            <div className="quick-grid three">
              <button onClick={() => startManualTOTP()}>Generate 2FA</button>
              <button onClick={resetManualTOTP}>Reset</button>
              <button onClick={writeSecretToSheet}>Write key to sheet</button>
            </div>
          </div>
        )}
      </section>

      <section className="glass-card">
        <div className="section-heading align-start">
          <div>
            <h2>📱 SMS Provider</h2>
            <p className="subtle">USA + Instagram only</p>
          </div>
          <button className="mini-button" onClick={() => toggleSection('sms')}>{collapsed.sms ? '+' : '−'}</button>
        </div>
        {!collapsed.sms && (
          <div className="stack">
            <label className="field-label" htmlFor="smsProvider">Provider</label>
            <select id="smsProvider" value={smsProvider} onChange={(event) => setSmsProvider(event.target.value)}>
              <option value="smspool">SMSPool.net</option>
              <option value="5sim">5SIM.net</option>
            </select>

            <label className="field-label" htmlFor="apiKey">
              {smsProvider === 'smspool' ? 'SMSPool API Key' : '5SIM Bearer Token'}
              <button className={`lock-button ${apiLocked ? 'unlocked' : ''}`} onClick={() => {
                setApiLocked((previous) => {
                  setStoredValue('apiKeyLocked', !previous);
                  return !previous;
                });
              }}>{apiLocked ? '🔓 Unlock' : '🔒 Lock'}</button>
            </label>
            {!apiLocked && <input id="apiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your key here" />}

            <div className="metric-card">
              <span>{balanceText}</span>
              <button className="mini-button" onClick={refreshBalance}>Refresh</button>
            </div>
            <div className="metric-card"><span>{stockText}</span></div>

            <div className="quick-grid three">
              <button onClick={getNumber} disabled={ordering}>{ordering ? 'Getting number...' : 'Get US Instagram Number'}</button>
              {smsProvider === 'smspool' && <button onClick={resendSMS} disabled={resending}>{resending ? 'Searching...' : 'Resend'}</button>}
              {currentOrderId && <button onClick={cancelOrder}>Cancel Order</button>}
            </div>

            {status.message && <div className={`status ${status.type}`}>{status.message}</div>}

            {phoneNumber && (
              <div className="result-card">
                <h3>Phone Number</h3>
                <p>{phoneNumber}</p>
                <button onClick={() => copyValue('Phone', phoneNumber)}>Copy</button>
              </div>
            )}
            {smsCode && (
              <div className="result-card">
                <h3>OTP/CODE</h3>
                <p>{smsCode}</p>
                <div className="quick-grid two">
                  <button onClick={() => copyValue('Code', smsCode)}>Copy</button>
                  <button onClick={resetSMS}>Reset</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {activeModal && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setActiveModal(null)}>❌</button>
            {activeModal === 'settings' && (
              <div className="stack modal-body">
                <h2>⚙️ Settings</h2>
                <label className="field-label" htmlFor="userSelect">User</label>
                <select id="userSelect" value={settingsDraft.user} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, user: event.target.value }))}>
                  {USERS.map((user) => <option key={user} value={user}>{user}</option>)}
                </select>
                <label className="field-label" htmlFor="platformSelect">Platform</label>
                <select id="platformSelect" value={settingsDraft.platform} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, platform: event.target.value }))}>
                  {PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                </select>
                <button onClick={saveSettings}>Save Settings</button>
              </div>
            )}
            {activeModal === 'accounts' && (
              <TableModal title="📄 Accounts Sheet" rows={modalRows} columns={[['username', 'Username'], ['location', 'Location'], ['container', 'Container ID']]} />
            )}
            {activeModal === 'posts' && (
              <TableModal title="📝 Posts Sheet" rows={modalRows} columns={DAY_COLUMNS.map((day) => [day, day])} />
            )}
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </main>
  );
}

function TableModal({ title, rows, columns }) {
  return (
    <div className="table-wrap modal-body">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map(([key]) => <td key={key}>{row[key] || ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
