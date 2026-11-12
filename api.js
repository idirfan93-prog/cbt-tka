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
    return request('startOrResumeExam', {
      jadwal_id: jadwalId,
      token_ujian: tokenUjian || ''
    });
  }

  function syncProgress(jadwalId, jawabanObj) {
    return request('syncProgress', {
      jadwal_id: jadwalId,
      jawaban: jawabanObj || {}
    });
  }

  function submitExam(jadwalId, jawabanObj) {
    return request('submitExam', {
      jadwal_id: jadwalId,
      jawaban: jawabanObj || {}
    });
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

    startHybridCheckpoint: function (userId, jadwalId, onSyncStatusChange) {
      this.stopHybridCheckpoint();
      activeExamContext = {
        userId: userId,
        jadwalId: jadwalId
      };

      const self = this;
      const scheduleNext = function () {
        const baseIntervalMs = 3 * 60 * 1000;
        const randomJitterMs = Math.floor(Math.random() * 25000);
        syncTimerId = setTimeout(async function () {
          if (!activeExamContext) {
            return;
          }
          const latestDraft = self.getDraft(userId, jadwalId);
          if (latestDraft && latestDraft.answers) {
            try {
              if (onSyncStatusChange) {
                onSyncStatusChange('syncing');
              }
              await syncProgress(jadwalId, latestDraft.answers);
              if (onSyncStatusChange) {
                onSyncStatusChange('synced');
              }
            } catch (e) {
              if (onSyncStatusChange) {
                onSyncStatusChange('local');
              }
            }
          }
          scheduleNext();
        }, baseIntervalMs + randomJitterMs);
      };

      scheduleNext();

      if (!lifecycleBound) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') {
            self.sendEmergencyBeacon();
          }
        });
        window.addEventListener('pagehide', function () {
          self.sendEmergencyBeacon();
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
    ExamStorage: ExamStorage
  };
})();
