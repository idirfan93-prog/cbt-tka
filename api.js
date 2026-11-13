const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyIY0ImP9V5GdevJ51Oi-K6lyCtLQxjxWGa6mo9EmWS9nlCqW79LhBxHm5WMmyJo0Qb/exec';

const STORAGE_KEYS = {
  API_URL: 'cbt_edutryout_gas_url',
  SESSION: 'cbt_edutryout_session',
  MASTER_CONFIG: 'cbt_edutryout_master_cfg',
  DRAFT_PREFIX: 'cbt_edutryout_draft_'
};

const EduApi = (function () {
  let syncTimerId = null;
  let activeExamContext = null;
  let lifecycleBound = false;
  let hasUnsyncedChanges = false;
  let isSyncInFlight = false;

  function getApiUrl() {
    return localStorage.getItem(STORAGE_KEYS.API_URL) || DEFAULT_GAS_URL;
  }

  function setApiUrl(url) {
    if (url && String(url).trim().startsWith('https://')) {
      localStorage.setItem(STORAGE_KEYS.API_URL, String(url).trim());
    }
  }

  function getSession() {
    const rawLocal = localStorage.getItem(STORAGE_KEYS.SESSION);
    const rawSession = sessionStorage.getItem(STORAGE_KEYS.SESSION);
    const raw = rawLocal || rawSession;
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveSession(token, user, remember) {
    const payload = JSON.stringify({
      token: token,
      user: user,
      saved_at: Date.now()
    });
    if (remember) {
      localStorage.setItem(STORAGE_KEYS.SESSION, payload);
      sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    } else {
      sessionStorage.setItem(STORAGE_KEYS.SESSION, payload);
      localStorage.removeItem(STORAGE_KEYS.SESSION);
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.MASTER_CONFIG);
  }

  async function request(action, data, options) {
    const opts = options || {};
    const url = getApiUrl();
    if (!url || url.indexOf('PASTE_DEPLOYMENT_ID') !== -1) {
      throw new Error('URL Web App GAS belum dikonfigurasi pada api.js.');
    }

    const session = getSession();
    const token = opts.token || (session ? session.token : '');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: action,
        token: token,
        data: data || {}
      })
    });

    if (!response.ok) {
      throw new Error('Gagal terhubung ke server GAS (HTTP ' + response.status + ').');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Permintaan ditolak oleh server.');
    }
    return result.data;
  }

  function isNonRetryableError_(err) {
    const msg = String((err && err.message) || '').toLowerCase();
    const stopPhrases = [
      'token ujian tidak sesuai',
      'sudah menyelesaikan ujian',
      'jadwal ujian tidak ditemukan',
      'belum aktif',
      'sesi tidak valid',
      'sesi telah berakhir',
      'hak akses',
      'toleransi pengumpulan'
    ];
    return stopPhrases.some(function (phrase) {
      return msg.indexOf(phrase) !== -1;
    });
  }

  function sleepMs_(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function requestWithRetry_(action, data, options) {
    const opts = options || {};
    const maxAttempts = opts.maxAttempts || 4;
    const baseDelays = [1400, 3200, 6500];
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await request(action, data, opts);
      } catch (err) {
        lastError = err;
        if (attempt >= maxAttempts || isNonRetryableError_(err)) {
          throw err;
        }
        if (typeof opts.onRetry === 'function') {
          opts.onRetry(attempt, maxAttempts);
        }
        const baseDelay = baseDelays[attempt - 1] || 7000;
        const jitter = Math.floor(Math.random() * 1800);
        await sleepMs_(baseDelay + jitter);
      }
    }
    throw lastError;
  }

  function checkSystemStatus() {
    return request('checkSystemStatus', {});
  }

  function setupFirstAdmin(payload) {
    return request('setupFirstAdmin', payload);
  }

  function login(identifier, password) {
    return request('login', {
      identifier: identifier,
      password: password
    });
  }

  async function getMasterConfig(forceRefresh) {
    if (!forceRefresh) {
      const cached = sessionStorage.getItem(STORAGE_KEYS.MASTER_CONFIG);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
          sessionStorage.removeItem(STORAGE_KEYS.MASTER_CONFIG);
        }
      }
    }
    const data = await request('getMasterConfig', {});
    sessionStorage.setItem(STORAGE_KEYS.MASTER_CONFIG, JSON.stringify(data));
    return data;
  }

  function invalidateMasterConfigCache() {
    sessionStorage.removeItem(STORAGE_KEYS.MASTER_CONFIG);
  }

  function getAvailableExams() {
    return request('getAvailableExams', {});
  }

  function startOrResumeExam(jadwalId, tokenUjian) {
    return requestWithRetry_(
      'startOrResumeExam',
      {
        jadwal_id: jadwalId,
        token_ujian: tokenUjian || ''
      },
      { maxAttempts: 4 }
    );
  }

  function syncProgress(jadwalId, jawabanObj, options) {
    return requestWithRetry_(
      'syncProgress',
      {
        jadwal_id: jadwalId,
        jawaban: jawabanObj || {}
      },
      Object.assign({ maxAttempts: 3 }, options || {})
    );
  }

  function submitExam(jadwalId, jawabanObj, options) {
    return requestWithRetry_(
      'submitExam',
      {
        jadwal_id: jadwalId,
        jawaban: jawabanObj || {}
      },
      Object.assign({ maxAttempts: 4 }, options || {})
    );
  }

  function getTeacherDashboard(sekolahId) {
    return request('getTeacherDashboard', {
      sekolah_id: sekolahId || ''
    });
  }

  function getAdminDashboard(filterHari) {
    return request('getAdminDashboard', {
      filter_hari: filterHari || 7
    });
  }

  function getEntityData(entity) {
    return request('getEntityData', {
      entity: entity
    });
  }

  function saveEntityRecord(entity, operation, payload) {
    const body = Object.assign({ entity: entity, operation: operation }, payload || {});
    return request('saveEntityRecord', body);
  }

  function saveGeminiConfig(apiKey, mode) {
    return request('saveGeminiConfig', {
      api_key: apiKey || '',
      mode: mode || 'save'
    });
  }

  function getStudentReportDetail(hasilId) {
    return request('getStudentReportDetail', {
      hasil_id: hasilId
    });
  }

  function generateGeminiStudentAnalysis(hasilId, forceRegenerate) {
    return request('generateGeminiStudentAnalysis', {
      hasil_id: hasilId,
      force_regenerate: Boolean(forceRegenerate)
    });
  }

  function getClassItemAnalysis(paketId, sekolahId) {
    return request('getClassItemAnalysis', {
      paket_id: paketId,
      sekolah_id: sekolahId || ''
    });
  }

  function getPrintableAnswerKey(paketId) {
    return request('getPrintableAnswerKey', {
      paket_id: paketId
    });
  }

  function forceFinishExamSession(hasilId) {
    return request('forceFinishExamSession', {
      hasil_id: hasilId
    });
  }

  const ExamStorage = {
    buildKey: function (userId, jadwalId) {
      return STORAGE_KEYS.DRAFT_PREFIX + String(userId) + '_' + String(jadwalId);
    },

    saveDraft: function (userId, jadwalId, draftState) {
      if (!userId || !jadwalId) {
        return;
      }
      const key = this.buildKey(userId, jadwalId);
      const record = Object.assign({}, draftState, {
        user_id: userId,
        jadwal_id: jadwalId,
        updated_at: new Date().toISOString()
      });
      localStorage.setItem(key, JSON.stringify(record));
      hasUnsyncedChanges = true;
    },

    getDraft: function (userId, jadwalId) {
      if (!userId || !jadwalId) {
        return null;
      }
      const raw = localStorage.getItem(this.buildKey(userId, jadwalId));
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },

    markPendingSubmit: function (userId, jadwalId) {
      const existing = this.getDraft(userId, jadwalId);
      if (existing) {
        existing.pending_submit = true;
        this.saveDraft(userId, jadwalId, existing);
      }
    },

    clearDraft: function (userId, jadwalId) {
      if (!userId || !jadwalId) {
        return;
      }
      localStorage.removeItem(this.buildKey(userId, jadwalId));
    },

    getAllUserDrafts: function (userId) {
      const prefix = STORAGE_KEYS.DRAFT_PREFIX + String(userId) + '_';
      const drafts = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(prefix) === 0) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (parsed && parsed.jadwal_id) {
              drafts.push(parsed);
            }
          } catch (e) {
            localStorage.removeItem(key);
          }
        }
      }
      return drafts;
    },

    recoverInterruptedExams: async function (userId) {
      const drafts = this.getAllUserDrafts(userId);
      const outcome = {
        autoSubmitted: [],
        resumableDraft: null
      };

      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        const deadlineMs = draft.batas_waktu_server ? new Date(draft.batas_waktu_server).getTime() : 0;
        const isExpired = deadlineMs > 0 && Date.now() >= deadlineMs;

        if (draft.pending_submit || isExpired) {
          try {
            const res = await submitExam(draft.jadwal_id, draft.answers || {});
            this.clearDraft(userId, draft.jadwal_id);
            outcome.autoSubmitted.push({
              jadwal_id: draft.jadwal_id,
              nama_ujian: draft.nama_ujian || draft.jadwal_id,
              skor_akhir: res.skor_akhir
            });
          } catch (err) {
            this.markPendingSubmit(userId, draft.jadwal_id);
          }
        } else if (!outcome.resumableDraft) {
          outcome.resumableDraft = draft;
        }
      }

      return outcome;
    },

    sendEmergencyBeacon: function () {
      if (!activeExamContext) {
        return;
      }
      const session = getSession();
      const url = getApiUrl();
      if (!session || !url || url.indexOf('PASTE_DEPLOYMENT_ID') !== -1) {
        return;
      }

      const draft = this.getDraft(activeExamContext.userId, activeExamContext.jadwalId);
      if (!draft) {
        return;
      }

      const payload = JSON.stringify({
        action: 'syncProgress',
        token: session.token,
        data: {
          jadwal_id: activeExamContext.jadwalId,
          jawaban: draft.answers || {}
        }
      });

      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' });
        navigator.sendBeacon(url, blob);
      }
    },

    flushOutboxNow: async function (userId, jadwalId, onSyncStatusChange) {
      if (isSyncInFlight) {
        return false;
      }
      const latestDraft = this.getDraft(userId, jadwalId);
      if (!latestDraft || !latestDraft.answers) {
        return false;
      }

      isSyncInFlight = true;
      hasUnsyncedChanges = false;
      try {
        if (onSyncStatusChange) {
          onSyncStatusChange('syncing');
        }
        await syncProgress(jadwalId, latestDraft.answers, {
          onRetry: function () {
            if (onSyncStatusChange) {
              onSyncStatusChange('retrying');
            }
          }
        });
        if (onSyncStatusChange) {
          onSyncStatusChange('synced');
        }
        return true;
      } catch (e) {
        hasUnsyncedChanges = true;
        if (onSyncStatusChange) {
          onSyncStatusChange('local');
        }
        return false;
      } finally {
        isSyncInFlight = false;
      }
    },

    startHybridCheckpoint: function (userId, jadwalId, onSyncStatusChange) {
      this.stopHybridCheckpoint();
      activeExamContext = {
        userId: userId,
        jadwalId: jadwalId
      };
      hasUnsyncedChanges = false;

      const self = this;
      const scheduleNext = function () {
        const baseIntervalMs = 60 * 1000;
        const randomJitterMs = Math.floor(Math.random() * 30000);
        syncTimerId = setTimeout(async function () {
          if (!activeExamContext) {
            return;
          }
          if (hasUnsyncedChanges && !isSyncInFlight) {
            await self.flushOutboxNow(userId, jadwalId, onSyncStatusChange);
          }
          scheduleNext();
        }, baseIntervalMs + randomJitterMs);
      };

      scheduleNext();

      if (!lifecycleBound) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden' && hasUnsyncedChanges) {
            self.sendEmergencyBeacon();
          }
        });
        window.addEventListener('pagehide', function () {
          if (hasUnsyncedChanges) {
            self.sendEmergencyBeacon();
          }
        });
        lifecycleBound = true;
      }
    },

    stopHybridCheckpoint: function () {
      if (syncTimerId) {
        clearTimeout(syncTimerId);
        syncTimerId = null;
      }
      activeExamContext = null;
      hasUnsyncedChanges = false;
      isSyncInFlight = false;
    }
  };

  return {
    getApiUrl: getApiUrl,
    setApiUrl: setApiUrl,
    getSession: getSession,
    saveSession: saveSession,
    clearSession: clearSession,
    request: request,
    checkSystemStatus: checkSystemStatus,
    setupFirstAdmin: setupFirstAdmin,
    login: login,
    getMasterConfig: getMasterConfig,
    invalidateMasterConfigCache: invalidateMasterConfigCache,
    getAvailableExams: getAvailableExams,
    startOrResumeExam: startOrResumeExam,
    syncProgress: syncProgress,
    submitExam: submitExam,
    getTeacherDashboard: getTeacherDashboard,
    getAdminDashboard: getAdminDashboard,
    getEntityData: getEntityData,
    saveEntityRecord: saveEntityRecord,
    saveGeminiConfig: saveGeminiConfig,
    getStudentReportDetail: getStudentReportDetail,
    generateGeminiStudentAnalysis: generateGeminiStudentAnalysis,
    getClassItemAnalysis: getClassItemAnalysis,
    getPrintableAnswerKey: getPrintableAnswerKey,
    forceFinishExamSession: forceFinishExamSession,
    ExamStorage: ExamStorage
  };
})();
