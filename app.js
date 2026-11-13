const EduApp = (function () {
  const state = {
    user: null,
    masterConfig: [],
    sekolahList: [],
    paketList: [],
    availableExams: [],
    activeExam: null,
    currentQuestionIndex: 0,
    answers: {},
    doubtfulMap: {},
    timerInterval: null,
    serverTimeOffsetMs: 0,
    isSubmittingExam: false,
    examFontScale: localStorage.getItem('cbt_exam_font_scale') || 'normal',
    passedPhaseBreaks: {},
    surveyPhaseStarted: false,
    portalTab: 'beranda',
    adminFilterDays: 7,
    crudRecords: [],
    modalSaveHandler: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showLoader(text) {
    const loader = $('app-loader');
    const label = $('app-loader-text');
    if (label && text) {
      label.textContent = text;
    }
    if (loader) {
      loader.classList.remove('hidden');
    }
  }

  function hideLoader() {
    const loader = $('app-loader');
    if (loader) {
      loader.classList.add('hidden');
    }
  }

  function showToast(message, type) {
    const container = $('toast-container');
    if (!container) {
      return;
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 4200);
  }

  function refreshIcons() {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  function switchMainView(viewName) {
    ['view-login', 'view-exam', 'view-portal'].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.classList.add('hidden');
      }
    });
    const target = $('view-' + viewName);
    if (target) {
      target.classList.remove('hidden');
    }
    refreshIcons();
  }

  function openModal(title, bodyHtml, saveText, onSave, hideSave, cancelText) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const cancelBtn = $('btn-modal-cancel');
    if (cancelBtn) {
      cancelBtn.textContent = cancelText || 'Batal';
    }
    const saveBtn = $('btn-modal-save');
    saveBtn.textContent = saveText || 'Simpan Data';
    if (hideSave) {
      saveBtn.classList.add('hidden');
    } else {
      saveBtn.classList.remove('hidden');
    }
    state.modalSaveHandler = onSave || null;
    $('global-modal').classList.remove('hidden');
    refreshIcons();
  }

  function closeModal() {
    $('global-modal').classList.add('hidden');
    $('modal-body').innerHTML = '';
    const cancelBtn = $('btn-modal-cancel');
    if (cancelBtn) {
      cancelBtn.textContent = 'Batal';
    }
    state.modalSaveHandler = null;
  }

  function getConfigByType(tipe) {
    return (state.masterConfig || []).filter(function (c) {
      return String(c.tipe_config || '').toUpperCase() === String(tipe).toUpperCase();
    });
  }

  function resolveConfigLabel(kode) {
    if (!kode) {
      return '-';
    }
    const found = (state.masterConfig || []).find(function (c) {
      return String(c.kode) === String(kode);
    });
    return found ? found.label : kode;
  }

  function resolveSekolahName(sekolahId) {
    if (!sekolahId) {
      return '-';
    }
    if (String(sekolahId).toUpperCase() === 'SEMUA') {
      return 'Semua Sekolah';
    }
    if (String(sekolahId).toUpperCase() === 'PUSAT') {
      return 'Koordinator Pusat';
    }
    const found = (state.sekolahList || []).find(function (s) {
      return String(s.sekolah_id) === String(sekolahId);
    });
    return found ? found.nama_sekolah : sekolahId;
  }

  function normalizeDriveImageUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) {
      return '';
    }
    const filePathMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (filePathMatch && filePathMatch[1]) {
      return 'https://drive.google.com/thumbnail?id=' + filePathMatch[1] + '&sz=w800';
    }
    const queryIdMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?.*?id=([a-zA-Z0-9_-]+)/);
    if (queryIdMatch && queryIdMatch[1]) {
      return 'https://drive.google.com/thumbnail?id=' + queryIdMatch[1] + '&sz=w800';
    }
    return trimmed;
  }

  function compressImageToWebpDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (ev) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          let maxWidth = 800;
          let quality = 0.78;
          let dataUrl = '';

          while (quality >= 0.42) {
            const scale = img.width > maxWidth ? maxWidth / img.width : 1;
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            dataUrl = canvas.toDataURL('image/webp', quality);
            if (dataUrl.indexOf('data:image/webp') !== 0) {
              dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            if (dataUrl.length <= 45000) {
              break;
            }
            quality -= 0.12;
            maxWidth = Math.max(520, maxWidth - 100);
          }

          if (dataUrl.length > 48000) {
            reject(new Error('Ukuran gambar masih terlalu besar untuk sel Sheets. Gunakan gambar lebih sederhana atau link Google Drive.'));
            return;
          }

          const approxKb = Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));
          resolve({ dataUrl: dataUrl, sizeKb: approxKb });
        };
        img.onerror = function () {
          reject(new Error('File gambar tidak dapat dibaca.'));
        };
        img.src = ev.target.result;
      };
      reader.onerror = function () {
        reject(new Error('Gagal membaca file dari perangkat.'));
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadMasterContext(forceRefresh) {
    try {
      const res = await EduApi.getMasterConfig(forceRefresh);
      state.masterConfig = res.konfigurasi || [];
      state.sekolahList = res.sekolah || [];
    } catch (e) {
      state.masterConfig = [];
      state.sekolahList = [];
    }
  }

  async function init() {
    bindEvents();
    refreshIcons();

    const existingSession = EduApi.getSession();
    if (existingSession && existingSession.token && existingSession.user) {
      state.user = existingSession.user;
      await routeAuthenticatedUser();
      return;
    }

    switchMainView('login');
    showLoader('Memeriksa status sistem...');
    try {
      const status = await EduApi.checkSystemStatus();
      if (status && status.needs_setup) {
        $('first-admin-setup-box').classList.remove('hidden');
        $('standard-login-box').classList.add('hidden');
      } else {
        $('first-admin-setup-box').classList.add('hidden');
        $('standard-login-box').classList.remove('hidden');
      }
    } catch (err) {
      const alertBox = $('login-alert');
      alertBox.textContent = err.message;
      alertBox.classList.remove('hidden');
    } finally {
      hideLoader();
    }
  }

  async function routeAuthenticatedUser() {
    const role = String(state.user.role || '').toLowerCase();
    showLoader('Menyiapkan ruang kerja...');
    try {
      await loadMasterContext(false);
      if (role === 'siswa') {
        switchMainView('exam');
        await initStudentExamEnvironment();
      } else {
        switchMainView('portal');
        await initPortalEnvironment();
      }
    } catch (err) {
      showToast(err.message, 'error');
      EduApi.clearSession();
      switchMainView('login');
    } finally {
      hideLoader();
    }
  }

  /* ================= STUDENT EXAM ENGINE ================= */
  async function initStudentExamEnvironment() {
    $('exam-user-name').textContent = state.user.nama_lengkap || state.user.username;
    $('exam-user-class').textContent = state.user.kelas ? 'Kelas ' + state.user.kelas : resolveSekolahName(state.user.sekolah_id);

    const recovery = await EduApi.ExamStorage.recoverInterruptedExams(state.user.user_id);
    if (recovery.autoSubmitted && recovery.autoSubmitted.length > 0) {
      const info = recovery.autoSubmitted[0];
      showToast('Ujian "' + info.nama_ujian + '" yang tertunda saat perangkat mati telah dikirim otomatis.', 'success');
    }

    await loadExamLobby();

    if (recovery.resumableDraft && recovery.resumableDraft.jadwal_id) {
      const targetExam = state.availableExams.find(function (ex) {
        return String(ex.jadwal_id) === String(recovery.resumableDraft.jadwal_id) && ex.status_pengerjaan !== 'SELESAI';
      });
      if (targetExam) {
        showToast('Memulihkan sesi ujian Anda yang tersimpan di perangkat...', 'info');
        await enterExamSession(targetExam.jadwal_id, '');
      }
    }
  }

  function applyExamFontScale(scale) {
    const validScales = ['normal', 'large', 'xlarge'];
    const chosen = validScales.indexOf(scale) !== -1 ? scale : 'normal';
    state.examFontScale = chosen;
    localStorage.setItem('cbt_exam_font_scale', chosen);

    const card = document.querySelector('.exam-question-card');
    if (card) {
      card.classList.remove('font-large', 'font-xlarge');
      if (chosen === 'large') {
        card.classList.add('font-large');
      } else if (chosen === 'xlarge') {
        card.classList.add('font-xlarge');
      }
    }

    document.querySelectorAll('.font-size-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-font-scale') === chosen);
    });
  }

  async function loadExamLobby() {
    $('exam-lobby').classList.remove('hidden');
    $('exam-workspace').classList.add('hidden');
    const fontControls = $('exam-font-controls');
    if (fontControls) {
      fontControls.classList.add('hidden');
    }
    $('exam-header-title').textContent = 'Daftar Asesmen Tersedia';

    const res = await EduApi.getAvailableExams();
    if (res.server_time) {
      state.serverTimeOffsetMs = new Date(res.server_time).getTime() - Date.now();
    }
    state.availableExams = res.exams || [];

    const grid = $('exam-schedule-list');
    const emptyBox = $('exam-lobby-empty');

    if (state.availableExams.length === 0) {
      grid.innerHTML = '';
      emptyBox.classList.remove('hidden');
      refreshIcons();
      return;
    }

    emptyBox.classList.add('hidden');
    grid.innerHTML = state.availableExams
      .map(function (ex) {
        const isFinished = String(ex.status_pengerjaan).toUpperCase() === 'SELESAI';
        const isResuming = String(ex.status_pengerjaan).toUpperCase() === 'SEDANG_MENGERJAKAN';
        const btnLabel = isFinished ? 'Sudah Selesai' : isResuming ? 'Lanjutkan Ujian' : 'Mulai Kerjakan';

        return (
          '<div class="exam-schedule-card">' +
            '<div>' +
              '<div class="exam-schedule-meta">' +
                '<span class="badge-solid-blue">' + EduDashboard.escapeHtml(ex.kategori_label) + '</span>' +
                '<span class="badge-soft-purple">' + EduDashboard.escapeHtml(ex.mapel_label) + '</span>' +
              '</div>' +
              '<h3>' + EduDashboard.escapeHtml(ex.nama_ujian) + '</h3>' +
              '<div class="exam-schedule-details">' +
                '<span>Kelas Target: <strong>' + EduDashboard.escapeHtml(ex.kelas || 'Semua') + '</strong></span>' +
                '<span>Durasi Pengerjaan: <strong>' + EduDashboard.escapeHtml(ex.durasi_menit) + ' Menit</strong></span>' +
                (isFinished && ex.skor_akhir !== null
                  ? '<span>Status: <strong style="color:#10b981;">Terkirim (Skor: ' + EduDashboard.escapeHtml(ex.skor_akhir) + ')</strong></span>'
                  : '') +
              '</div>' +
            '</div>' +
            '<button type="button" class="' + (isFinished ? 'btn-outline' : 'btn-primary-gradient') + '" ' +
              (isFinished ? 'disabled' : 'data-start-jadwal="' + EduDashboard.escapeHtml(ex.jadwal_id) + '" data-need-token="' + (ex.butuh_token ? '1' : '0') + '"') + '>' +
              '<span>' + btnLabel + '</span>' +
            '</button>' +
          '</div>'
        );
      })
      .join('');

    grid.querySelectorAll('[data-start-jadwal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const jadwalId = btn.getAttribute('data-start-jadwal');
        const needToken = btn.getAttribute('data-need-token') === '1';
        if (needToken) {
          openModal(
            'Masukkan Token Ujian',
            '<div class="form-group"><label>Token Sesi Ujian</label>' +
            '<input type="text" id="input-exam-token" class="form-control" placeholder="Ketik token dari pengawas/guru" /></div>',
            'Verifikasi & Mulai',
            async function () {
              const tokenVal = $('input-exam-token').value.trim();
              if (!tokenVal) {
                showToast('Token ujian wajib diisi.', 'warning');
                return;
              }
              closeModal();
              await enterExamSession(jadwalId, tokenVal);
            }
          );
        } else {
          enterExamSession(jadwalId, '');
        }
      });
    });

    refreshIcons();
  }

  async function enterExamSession(jadwalId, tokenUjian) {
    showLoader('Memuat paket soal...');
    try {
      const sessionData = await EduApi.startOrResumeExam(jadwalId, tokenUjian);
      if (sessionData.server_time) {
        state.serverTimeOffsetMs = new Date(sessionData.server_time).getTime() - Date.now();
      }

      if (!sessionData.soal || sessionData.soal.length === 0) {
        showToast('Paket ujian ini belum memiliki butir soal.', 'warning');
        return;
      }

      state.activeExam = sessionData;
      state.currentQuestionIndex = 0;
      state.passedPhaseBreaks = {};
      state.surveyPhaseStarted = false;

      const localDraft = EduApi.ExamStorage.getDraft(state.user.user_id, jadwalId);
      const serverDraft = sessionData.draft_jawaban || {};

      if (localDraft && localDraft.answers && Object.keys(localDraft.answers).length >= Object.keys(serverDraft).length) {
        state.answers = localDraft.answers;
        state.doubtfulMap = localDraft.doubtfulMap || {};
      } else {
        state.answers = serverDraft;
        state.doubtfulMap = {};
      }

      persistLocalExamDraft();

      $('exam-header-title').textContent = sessionData.paket.nama_ujian + (sessionData.paket.kelas ? ' (Kelas ' + sessionData.paket.kelas + ')' : '');
      $('exam-lobby').classList.add('hidden');
      $('exam-workspace').classList.remove('hidden');
      const fontControls = $('exam-font-controls');
      if (fontControls) {
        fontControls.classList.remove('hidden');
      }
      applyExamFontScale(state.examFontScale);

      renderNavGrid();
      renderCurrentQuestion();
      startExamCountdown();

      const hasAnyAcademic = sessionData.soal.some(function (s) {
        return String(s.tipe_soal_kode || 'PG').toUpperCase() !== 'SURVEI';
      });
      if (!hasAnyAcademic) {
        state.surveyPhaseStarted = true;
        openModal(
          'Panduan Fase Survei Karakter / Sulingjar',
          '<div style="line-height:1.6;color:#334155;">' +
            '<p>Anda memasuki sesi <strong>Survei Karakter / Lingkungan Belajar</strong>.</p>' +
            '<ul style="margin:10px 0 0 18px;display:flex;flex-direction:column;gap:6px;">' +
              '<li>Pada instrumen survei ini <strong>tidak ada jawaban benar atau salah</strong>.</li>' +
              '<li>Pilihlah pernyataan yang paling menggambarkan sikap, kebiasaan, dan pengalaman Anda sehari-hari secara jujur.</li>' +
            '</ul>' +
          '</div>',
          'Mulai Mengisi Survei',
          function () {
            closeModal();
          },
          false,
          'Tutup'
        );
      }

      EduApi.ExamStorage.startHybridCheckpoint(state.user.user_id, jadwalId, function (syncState) {
        updateSyncIndicator(syncState);
      });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      hideLoader();
    }
  }

  function updateSyncIndicator(syncState) {
    const pill = $('exam-sync-status');
    const text = $('exam-sync-text');
    if (!pill || !text) {
      return;
    }
    pill.classList.remove('syncing');
    if (syncState === 'syncing') {
      pill.classList.add('syncing');
      text.textContent = 'Menyinkronkan...';
    } else if (syncState === 'retrying') {
      pill.classList.add('syncing');
      text.textContent = 'Mengantre ke server...';
    } else if (syncState === 'synced') {
      text.textContent = 'Tersimpan Cloud & Lokal';
    } else {
      text.textContent = 'Tersimpan Lokal';
    }
  }

  function persistLocalExamDraft() {
    if (!state.activeExam || !state.user) {
      return;
    }
    EduApi.ExamStorage.saveDraft(state.user.user_id, state.activeExam.jadwal_id, {
      nama_ujian: state.activeExam.paket.nama_ujian,
      batas_waktu_server: state.activeExam.batas_waktu_server,
      answers: state.answers,
      doubtfulMap: state.doubtfulMap
    });
    updateSyncIndicator('local');
  }

  function isQuestionAnswered(soalId) {
    const val = state.answers[soalId];
    if (val === null || val === undefined || val === '') {
      return false;
    }
    if (Array.isArray(val)) {
      return val.length > 0;
    }
    if (typeof val === 'object') {
      return Object.keys(val).length > 0;
    }
    return true;
  }

  function getQuestionTypeLabel(tipeKode) {
    const fromMaster = resolveConfigLabel(tipeKode);
    if (fromMaster !== tipeKode) {
      return fromMaster;
    }
    const defaults = {
      PG: 'Pilihan Ganda',
      PGK_MCMA: 'Pilihan Ganda Kompleks',
      PGK_BS: 'Benar / Salah',
      SURVEI: 'Skala Survei'
    };
    return defaults[tipeKode] || tipeKode;
  }

  function renderNavGrid() {
    const soalList = state.activeExam ? state.activeExam.soal : [];
    const grid = $('exam-nav-grid');
    let answeredCount = 0;

    grid.innerHTML = soalList
      .map(function (s, idx) {
        const answered = isQuestionAnswered(s.soal_id);
        if (answered) {
          answeredCount++;
        }
        const classes = ['q-num-btn'];
        if (idx === state.currentQuestionIndex) {
          classes.push('current');
        } else if (state.doubtfulMap[s.soal_id]) {
          classes.push('doubtful');
        } else if (answered) {
          classes.push('answered');
        }
        return '<button type="button" class="' + classes.join(' ') + '" data-q-idx="' + idx + '">' + (idx + 1) + '</button>';
      })
      .join('');

    $('nav-progress-count').textContent = answeredCount + ' dari ' + soalList.length;

    grid.querySelectorAll('[data-q-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const targetIdx = Number(btn.getAttribute('data-q-idx')) || 0;
        navigateToQuestionIndex(targetIdx);
      });
    });
  }

  function commitQuestionNavigation(targetIdx) {
    state.currentQuestionIndex = targetIdx;
    renderCurrentQuestion();
    renderNavGrid();
  }

  function navigateToQuestionIndex(targetIdx) {
    if (!state.activeExam || !Array.isArray(state.activeExam.soal)) {
      return;
    }
    const soalList = state.activeExam.soal;
    if (targetIdx < 0 || targetIdx >= soalList.length || targetIdx === state.currentQuestionIndex) {
      return;
    }

    const currentIdx = state.currentQuestionIndex;
    const firstSurveyIdx = soalList.findIndex(function (s) {
      return String(s.tipe_soal_kode || 'PG').toUpperCase() === 'SURVEI';
    });
    const academicCount = firstSurveyIdx === -1 ? soalList.length : firstSurveyIdx;

    if (firstSurveyIdx !== -1 && currentIdx < firstSurveyIdx && targetIdx >= firstSurveyIdx && !state.surveyPhaseStarted) {
      const academicItems = soalList.slice(0, academicCount);
      const answeredAcademic = academicItems.filter(function (s) {
        return isQuestionAnswered(s.soal_id);
      }).length;
      const unansweredAcademic = academicCount - answeredAcademic;

      const html =
        '<div style="line-height:1.6;color:#334155;">' +
          '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-bottom:12px;">' +
            '<strong>Ringkasan Subtes Akademik:</strong> Anda telah menjawab <strong>' + answeredAcademic + ' dari ' + academicCount + '</strong> soal.' +
            (unansweredAcademic > 0 ? ' Masih ada <strong>' + unansweredAcademic + ' soal akademik</strong> yang belum dijawab.' : '') +
          '</div>' +
          '<p>Anda akan memasuki <strong>Fase Survei Karakter / Sulingjar</strong> (Soal No. ' + (firstSurveyIdx + 1) + ' s.d. ' + soalList.length + '):</p>' +
          '<ul style="margin:8px 0 0 18px;display:flex;flex-direction:column;gap:5px;">' +
            '<li>Pada bagian survei <strong>tidak ada jawaban benar atau salah</strong>.</li>' +
            '<li>Jawablah dengan jujur sesuai sikap dan kebiasaan Anda sehari-hari.</li>' +
          '</ul>' +
        '</div>';

      openModal(
        'Transisi ke Fase Survei Karakter / Sulingjar',
        html,
        'Mulai Fase Survei',
        function () {
          state.surveyPhaseStarted = true;
          closeModal();
          commitQuestionNavigation(targetIdx);
        },
        false,
        'Kembali Cek Soal Akademik'
      );
      return;
    }

    if (targetIdx > currentIdx && targetIdx < academicCount) {
      const currentBlock = Math.floor(currentIdx / 10);
      const targetBlock = Math.floor(targetIdx / 10);

      if (targetBlock > currentBlock) {
        const boundaryKey = 'PHASE_' + (currentBlock + 1);
        if (!state.passedPhaseBreaks[boundaryKey]) {
          const phaseStart = currentBlock * 10;
          const phaseEnd = Math.min(academicCount, (currentBlock + 1) * 10);
          const phaseSlice = soalList.slice(phaseStart, phaseEnd);
          const answeredCount = phaseSlice.filter(function (s) {
            return isQuestionAnswered(s.soal_id);
          }).length;
          const doubtfulCount = phaseSlice.filter(function (s) {
            return Boolean(state.doubtfulMap[s.soal_id]);
          }).length;
          const remainingCount = phaseSlice.length - answeredCount;

          const html =
            '<div style="line-height:1.6;color:#334155;">' +
              '<p>Anda telah mencapai akhir <strong>Fase ' + (currentBlock + 1) + ' (Soal No. ' + (phaseStart + 1) + ' – ' + phaseEnd + ')</strong>.</p>' +
              '<div style="background:#f8faff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin:10px 0;">' +
                '<div>• Terjawab pada fase ini: <strong>' + answeredCount + ' dari ' + phaseSlice.length + ' soal</strong></div>' +
                (remainingCount > 0 ? '<div style="color:#b45309;">• Belum dijawab: <strong>' + remainingCount + ' soal</strong></div>' : '') +
                (doubtfulCount > 0 ? '<div style="color:#b45309;">• Ditandai ragu-ragu: <strong>' + doubtfulCount + ' soal</strong></div>' : '') +
              '</div>' +
              '<p>Apakah Anda ingin melanjutkan ke <strong>Fase ' + (currentBlock + 2) + '</strong> atau memeriksa kembali jawaban pada fase ini?</p>' +
            '</div>';

          openModal(
            'Jeda Konfirmasi — Selesai Fase ' + (currentBlock + 1),
            html,
            'Lanjut ke Fase Berikutnya',
            function () {
              state.passedPhaseBreaks[boundaryKey] = true;
              closeModal();
              commitQuestionNavigation(targetIdx);
            },
            false,
            'Periksa Kembali Fase Ini'
          );
          return;
        }
      }
    }

    commitQuestionNavigation(targetIdx);
  }

  function renderCurrentQuestion() {
    const soalList = state.activeExam.soal;
    const idx = state.currentQuestionIndex;
    const soal = soalList[idx];
    if (!soal) {
      return;
    }

    $('q-number-badge').textContent = 'Soal No. ' + (idx + 1);
    $('q-type-badge').textContent = getQuestionTypeLabel(soal.tipe_soal_kode);

    const materiBadge = $('q-materi-badge');
    if (soal.lingkup_materi_kode) {
      materiBadge.textContent = resolveConfigLabel(soal.lingkup_materi_kode);
      materiBadge.classList.remove('hidden');
    } else {
      materiBadge.classList.add('hidden');
    }

    const stimBox = $('q-stimulus-box');
    const stimText = $('q-stimulus-text');
    const stimFig = $('q-stimulus-figure');
    const stimImg = $('q-stimulus-img');

    if (soal.stimulus_teks || soal.stimulus_gambar_url) {
      stimBox.classList.remove('hidden');
      stimText.textContent = soal.stimulus_teks || '';
      if (soal.stimulus_gambar_url) {
        stimImg.src = normalizeDriveImageUrl(soal.stimulus_gambar_url);
        stimFig.classList.remove('hidden');
      } else {
        stimFig.classList.add('hidden');
      }
    } else {
      stimBox.classList.add('hidden');
    }

    $('q-question-text').textContent = soal.pertanyaan || '';
    $('chk-doubtful').checked = Boolean(state.doubtfulMap[soal.soal_id]);

    renderPolymorphicOptions(soal);

    $('btn-prev-question').disabled = idx === 0;
    if (idx === soalList.length - 1) {
      $('btn-next-question').classList.add('hidden');
      $('btn-finish-exam').classList.remove('hidden');
    } else {
      $('btn-next-question').classList.remove('hidden');
      $('btn-finish-exam').classList.add('hidden');
    }
  }

  function renderPolymorphicOptions(soal) {
    const container = $('q-options-container');
    const tipe = String(soal.tipe_soal_kode || 'PG').toUpperCase();
    const currentAns = state.answers[soal.soal_id];

    if (tipe === 'PG' || tipe === 'SURVEI') {
      const opsiList = Array.isArray(soal.opsi) ? soal.opsi : [];
      const displayLetters = ['A', 'B', 'C', 'D', 'E'];
      container.innerHTML = opsiList
        .map(function (opt, i) {
          const optId = String(opt.id);
          const isSelected = String(currentAns) === optId;
          const badgeChar = tipe === 'SURVEI' ? String(i + 1) : (displayLetters[i] || optId);
          return (
            '<button type="button" class="option-item' + (isSelected ? ' selected' : '') + '" data-opt-id="' + EduDashboard.escapeHtml(optId) + '">' +
              '<span class="option-key-badge">' + EduDashboard.escapeHtml(badgeChar) + '</span>' +
              '<span class="option-label-text">' + EduDashboard.escapeHtml(opt.teks) + '</span>' +
            '</button>'
          );
        })
        .join('');

      container.querySelectorAll('[data-opt-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.answers[soal.soal_id] = btn.getAttribute('data-opt-id');
          persistLocalExamDraft();
          renderPolymorphicOptions(soal);
          renderNavGrid();
        });
      });
      return;
    }

    if (tipe === 'PGK_MCMA') {
      const opsiList = Array.isArray(soal.opsi) ? soal.opsi : [];
      const selectedArr = Array.isArray(currentAns) ? currentAns.map(String) : [];

      container.innerHTML = opsiList
        .map(function (opt) {
          const optId = String(opt.id);
          const isSelected = selectedArr.indexOf(optId) !== -1;
          return (
            '<button type="button" class="option-item checkbox-mode' + (isSelected ? ' selected' : '') + '" data-mcma-id="' + EduDashboard.escapeHtml(optId) + '">' +
              '<span class="option-key-badge">' + (isSelected ? '✓' : '') + '</span>' +
              '<span class="option-label-text">' + EduDashboard.escapeHtml(opt.teks) + '</span>' +
            '</button>'
          );
        })
        .join('');

      container.querySelectorAll('[data-mcma-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const idVal = btn.getAttribute('data-mcma-id');
          const nextArr = Array.isArray(state.answers[soal.soal_id]) ? state.answers[soal.soal_id].slice() : [];
          const pos = nextArr.indexOf(idVal);
          if (pos === -1) {
            nextArr.push(idVal);
          } else {
            nextArr.splice(pos, 1);
          }
          state.answers[soal.soal_id] = nextArr;
          persistLocalExamDraft();
          renderPolymorphicOptions(soal);
          renderNavGrid();
        });
      });
      return;
    }

    if (tipe === 'PGK_BS') {
      const opsiObj = soal.opsi && typeof soal.opsi === 'object' ? soal.opsi : { kolom: ['Benar', 'Salah'], baris: [] };
      const cols = Array.isArray(opsiObj.kolom) && opsiObj.kolom.length > 0 ? opsiObj.kolom : ['Benar', 'Salah'];
      const rows = Array.isArray(opsiObj.baris) ? opsiObj.baris : [];
      const ansMap = currentAns && typeof currentAns === 'object' && !Array.isArray(currentAns) ? currentAns : {};

      container.innerHTML =
        '<table class="pgk-bs-table"><thead><tr>' +
          '<th>Pernyataan</th>' +
          cols.map(function (c) { return '<th class="center">' + EduDashboard.escapeHtml(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        rows
          .map(function (r) {
            const rowId = String(r.id);
            return (
              '<tr>' +
                '<td>' + EduDashboard.escapeHtml(r.teks) + '</td>' +
                cols
                  .map(function (c) {
                    const checked = String(ansMap[rowId] || '') === String(c);
                    return (
                      '<td class="center">' +
                        '<input type="radio" class="pgk-radio" name="bs_' + EduDashboard.escapeHtml(rowId) + '" ' +
                        'data-bs-row="' + EduDashboard.escapeHtml(rowId) + '" value="' + EduDashboard.escapeHtml(c) + '"' +
                        (checked ? ' checked' : '') + ' />' +
                      '</td>'
                    );
                  })
                  .join('') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table>';

      container.querySelectorAll('.pgk-radio').forEach(function (radio) {
        radio.addEventListener('change', function () {
          const rId = radio.getAttribute('data-bs-row');
          const nextMap = Object.assign({}, state.answers[soal.soal_id] || {});
          nextMap[rId] = radio.value;
          state.answers[soal.soal_id] = nextMap;
          persistLocalExamDraft();
          renderNavGrid();
        });
      });
    }
  }

  function startExamCountdown() {
    stopExamCountdown();
    const deadlineMs = new Date(state.activeExam.batas_waktu_server).getTime();
    const display = $('exam-timer-display');

    const tick = function () {
      const nowServerMs = Date.now() + state.serverTimeOffsetMs;
      const diffSec = Math.max(0, Math.floor((deadlineMs - nowServerMs) / 1000));

      const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      display.textContent = hrs + ':' + mins + ':' + secs;

      if (diffSec <= 300) {
        display.classList.add('warning');
      } else {
        display.classList.remove('warning');
      }

      if (diffSec === 0 && !state.isSubmittingExam) {
        stopExamCountdown();
        showToast('Waktu pengerjaan telah habis. Mengirim jawaban otomatis...', 'warning');
        executeFinalSubmit(true);
      }
    };

    tick();
    state.timerInterval = setInterval(tick, 1000);
  }

  function stopExamCountdown() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  async function executeFinalSubmit(isAuto) {
    if (state.isSubmittingExam || !state.activeExam) {
      return;
    }
    state.isSubmittingExam = true;
    const jadwalId = state.activeExam.jadwal_id;
    const namaUjian = state.activeExam.paket.nama_ujian;

    showLoader(isAuto ? 'Waktu habis, mengirim jawaban otomatis...' : 'Mengirim dan menilai jawaban...');
    try {
      const result = await EduApi.submitExam(jadwalId, state.answers);
      stopExamCountdown();
      EduApi.ExamStorage.stopHybridCheckpoint();
      EduApi.ExamStorage.clearDraft(state.user.user_id, jadwalId);
      state.activeExam = null;

      const modeNilai = String(result.mode_penilaian || 'AKADEMIK').toUpperCase();
      const isSurveyOnly = modeNilai === 'SURVEI';
      const isCombined = modeNilai === 'KOMBINASI';
      const summaryHtml =
        '<div style="text-align:center;padding:12px 0;">' +
          '<p style="font-size:0.95rem;color:#475569;margin-bottom:10px;">Asesmen <strong>' + EduDashboard.escapeHtml(namaUjian) + '</strong> telah tercatat di server.</p>' +
          (isSurveyOnly
            ? '<div class="status-badge aktif" style="font-size:0.95rem;padding:8px 18px;">Respons Survei Berhasil Direkam</div>'
            : '<div style="font-size:2.4rem;font-weight:800;color:#1d63ff;">' + EduDashboard.escapeHtml(result.skor_akhir) + '</div><small style="color:#64748b;">Skor Akademik Akhir</small>' +
              (isCombined ? '<div style="margin-top:12px;"><span class="status-badge aktif">Respons Survei Karakter / Sulingjar Ikut Terekam</span></div>' : '')) +
        '</div>';

      openModal('Ujian Selesai', summaryHtml, 'Kembali ke Daftar Ujian', function () {
        closeModal();
      }, true);

      await loadExamLobby();
    } catch (err) {
      EduApi.ExamStorage.markPendingSubmit(state.user.user_id, jadwalId);
      showToast('Koneksi terganggu. Jawaban tersimpan aman di perangkat dan akan dikirim ulang otomatis saat online.', 'warning');
    } finally {
      state.isSubmittingExam = false;
      hideLoader();
    }
  }

  /* ================= TEACHER & ADMIN PORTAL ================= */
  function getPortalMenus(role) {
    if (role === 'guru') {
      return [
        { key: 'beranda', label: 'Beranda', icon: 'home' },
        { key: 'users', label: 'Data Siswa', icon: 'users', entity: 'Users' },
        { key: 'jadwal', label: 'Jadwal Pelaksanaan', icon: 'calendar-clock', entity: 'Jadwal_Ujian' },
        { key: 'hasil', label: 'Hasil dan Rekap', icon: 'bar-chart-2', entity: 'Hasil_Ujian' }
      ];
    }
    return [
      { key: 'beranda', label: 'Beranda', icon: 'home' },
      { key: 'konfigurasi', label: 'Pengaturan Sistem', icon: 'settings', entity: 'Master_Konfigurasi' },
      { key: 'sekolah', label: 'Manajemen Sekolah', icon: 'building-2', entity: 'Sekolah' },
      { key: 'users', label: 'Manajemen Pengguna', icon: 'users', entity: 'Users' },
      { key: 'soal', label: 'Bank Soal (Pusat)', icon: 'database', entity: 'Bank_Soal' },
      { key: 'paket', label: 'Paket & Ujian', icon: 'file-text', entity: 'Paket_Ujian' },
      { key: 'jadwal', label: 'Jadwal & Pelaksanaan', icon: 'calendar-clock', entity: 'Jadwal_Ujian' },
      { key: 'hasil', label: 'Hasil & Rekap', icon: 'bar-chart-2', entity: 'Hasil_Ujian' }
    ];
  }

  async function initPortalEnvironment() {
    const role = String(state.user.role || '').toLowerCase();
    const isAdmin = role === 'admin';

    $('portal-role-badge').innerHTML = isAdmin
      ? '<i data-lucide="crown"></i><span>Portal Admin</span>'
      : '<i data-lucide="graduation-cap"></i><span>Portal Guru</span>';
    $('portal-user-name').textContent = state.user.nama_lengkap || state.user.username;
    $('portal-user-role').textContent = isAdmin ? 'Admin' : 'Guru';
    $('sidebar-user-name').textContent = state.user.nama_lengkap || (isAdmin ? 'Admin' : 'Guru');
    $('sidebar-user-sub').textContent = state.user.nama_sekolah || (isAdmin ? 'Koordinator Pusat' : 'Sekolah');

    renderSidebarMenu();
    await navigatePortalTab('beranda');
  }

  function renderSidebarMenu() {
    const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
    const nav = $('portal-nav-menu');
    nav.innerHTML = menus
      .map(function (m) {
        const activeClass = state.portalTab === m.key ? ' active' : '';
        return (
          '<button type="button" class="sidebar-nav-item' + activeClass + '" data-menu-key="' + m.key + '">' +
            '<i data-lucide="' + m.icon + '"></i>' +
            '<span>' + EduDashboard.escapeHtml(m.label) + '</span>' +
          '</button>'
        );
      })
      .join('');

    nav.querySelectorAll('[data-menu-key]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('portal-sidebar').classList.remove('open');
        navigatePortalTab(btn.getAttribute('data-menu-key'));
      });
    });

    refreshIcons();
  }

  async function navigatePortalTab(tabKey) {
    state.portalTab = tabKey;
    renderSidebarMenu();

    const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
    const menuObj = menus.find(function (m) { return m.key === tabKey; }) || menus[0];

    if (menuObj.key === 'beranda') {
      $('tab-beranda').classList.remove('hidden');
      $('tab-crud').classList.add('hidden');
      await loadPortalDashboard();
      return;
    }

    $('tab-beranda').classList.add('hidden');
    $('tab-crud').classList.remove('hidden');
    await loadCrudModule(menuObj);
  }

  async function loadPortalDashboard() {
    showLoader('Memuat analitik dashboard...');
    try {
      const role = String(state.user.role || '').toLowerCase();
      if (role === 'guru') {
        const dashData = await EduApi.getTeacherDashboard(state.user.sekolah_id);
        EduDashboard.renderTeacherBeranda(dashData, navigatePortalTab);
      } else {
        const adminData = await EduApi.getAdminDashboard(state.adminFilterDays);
        EduDashboard.renderAdminBeranda(
          adminData,
          navigatePortalTab,
          async function (newDays) {
            state.adminFilterDays = newDays;
            await loadPortalDashboard();
          },
          state.adminFilterDays
        );
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      hideLoader();
    }
  }

  async function loadCrudModule(menuObj) {
    showLoader('Memuat ' + menuObj.label + '...');
    try {
      await loadMasterContext(false);
      if (menuObj.entity === 'Bank_Soal' || menuObj.entity === 'Jadwal_Ujian' || menuObj.entity === 'Hasil_Ujian') {
        const pktRes = await EduApi.getEntityData('Paket_Ujian');
        state.paketList = pktRes.records || [];
      }

      const res = await EduApi.getEntityData(menuObj.entity);
      state.crudRecords = res.records || [];

      $('crud-title').textContent = menuObj.label;
      $('crud-subtitle').textContent = getCrudSubtitle(menuObj.entity);
      $('crud-search').value = '';

      const addBtn = $('btn-crud-add');
      const importBtn = $('btn-crud-import');
      const printBtn = $('btn-crud-print');
      const cardsBtn = $('btn-crud-cards');
      const copySoalBtn = $('btn-crud-copy-soal');
      const previewSoalBtn = $('btn-crud-preview-soal');
      const geminiBtn = $('btn-crud-gemini');
      const analysisExcelBtn = $('btn-crud-analysis-excel');
      const answerKeyBtn = $('btn-crud-answer-key');
      const filterSel = $('crud-filter');

      addBtn.classList.add('hidden');
      importBtn.classList.add('hidden');
      printBtn.classList.add('hidden');
      cardsBtn.classList.add('hidden');
      copySoalBtn.classList.add('hidden');
      previewSoalBtn.classList.add('hidden');
      geminiBtn.classList.add('hidden');
      analysisExcelBtn.classList.add('hidden');
      answerKeyBtn.classList.add('hidden');
      filterSel.classList.add('hidden');

      const isGuru = String(state.user.role || '').toLowerCase() === 'guru';

      if (menuObj.entity !== 'Hasil_Ujian' && !(isGuru && menuObj.entity === 'Jadwal_Ujian')) {
        addBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Users' || menuObj.entity === 'Sekolah' || menuObj.entity === 'Bank_Soal') {
        importBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Bank_Soal') {
        copySoalBtn.classList.remove('hidden');
        previewSoalBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Users') {
        cardsBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Master_Konfigurasi') {
        geminiBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Hasil_Ujian') {
        analysisExcelBtn.classList.remove('hidden');
        answerKeyBtn.classList.remove('hidden');
        printBtn.classList.remove('hidden');
      }

      setupCrudFilter(menuObj.entity, filterSel);
      renderCrudTable(menuObj.entity, state.crudRecords);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      hideLoader();
    }
  }

  function getCrudSubtitle(entity) {
    const isGuru = String(state.user.role || '').toLowerCase() === 'guru';
    if (entity === 'Jadwal_Ujian' && isGuru) {
      return 'Daftar informasi jadwal pelaksanaan asesmen dan token sesi dari Admin (hanya baca).';
    }
    const map = {
      Master_Konfigurasi: 'Atur Kategori Ujian (TKA, Survei Karakter, Sulingjar), Mata Pelajaran, Lingkup Materi, dan Bentuk Soal secara dinamis.',
      Sekolah: 'Kelola daftar sekolah peserta asesmen di wilayah Anda.',
      Users: 'Kelola akun Siswa, Guru, dan Admin secara satuan atau impor massal.',
      Paket_Ujian: 'Rakit paket asesmen dengan durasi, kelas sasaran, dan mode penilaian.',
      Bank_Soal: 'Kelola butir soal Pilihan Ganda, PG Kompleks (MCMA / Benar-Salah), dan Skala Survei.',
      Jadwal_Ujian: 'Atur waktu pelaksanaan, token ujian, dan status aktivasi sesi.',
      Hasil_Ujian: 'Pantau progres pengerjaan, skor akhir, dan cetak rekapitulasi hasil.'
    };
    return map[entity] || 'Kelola data sistem.';
  }

  function setupCrudFilter(entity, filterSel) {
    if (entity === 'Master_Konfigurasi') {
      filterSel.classList.remove('hidden');
      filterSel.innerHTML =
        '<option value="">Semua Tipe Konfigurasi</option>' +
        '<option value="KATEGORI_UJIAN">Kategori Ujian</option>' +
        '<option value="MAPEL">Mata Pelajaran</option>' +
        '<option value="ELEMEN">Elemen (Induk Laporan - Tingkat 1)</option>' +
        '<option value="SUB_ELEMEN">Sub-Elemen (Tingkat 2)</option>' +
        '<option value="LINGKUP_MATERI">Kompetensi / Deskripsi Indikator (Tingkat 3)</option>' +
        '<option value="TIPE_SOAL">Bentuk / Tipe Soal</option>';
    } else if (entity === 'Bank_Soal') {
      filterSel.classList.remove('hidden');
      filterSel.innerHTML =
        '<option value="">Semua Paket Ujian</option>' +
        state.paketList
          .map(function (p) {
            return '<option value="' + EduDashboard.escapeHtml(p.paket_id) + '">' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
          })
          .join('');
    } else if (entity === 'Hasil_Ujian') {
      filterSel.classList.remove('hidden');
      filterSel.innerHTML =
        '<option value="">Semua Paket Asesmen</option>' +
        state.paketList
          .map(function (p) {
            return '<option value="' + EduDashboard.escapeHtml(p.nama_ujian) + '">' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
          })
          .join('');
    } else if (entity === 'Users' && String(state.user.role).toLowerCase() === 'admin') {
      filterSel.classList.remove('hidden');
      filterSel.innerHTML =
        '<option value="">Semua Peran</option>' +
        '<option value="siswa">Siswa</option>' +
        '<option value="guru">Guru</option>' +
        '<option value="admin">Admin</option>';
    } else {
      filterSel.innerHTML = '';
    }
  }

  function applyCrudFilters() {
    const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
    const menuObj = menus.find(function (m) { return m.key === state.portalTab; });
    if (!menuObj || !menuObj.entity) {
      return;
    }

    const q = $('crud-search').value.trim().toLowerCase();
    const filterVal = $('crud-filter').value;

    const filtered = state.crudRecords.filter(function (row) {
      if (menuObj.entity === 'Master_Konfigurasi' && filterVal && row.tipe_config !== filterVal) {
        return false;
      }
      if (menuObj.entity === 'Bank_Soal' && filterVal && String(row.paket_id) !== String(filterVal)) {
        return false;
      }
      if (menuObj.entity === 'Hasil_Ujian' && filterVal && String(row.nama_paket) !== String(filterVal)) {
        return false;
      }
      if (menuObj.entity === 'Users' && filterVal && String(row.role).toLowerCase() !== String(filterVal)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return JSON.stringify(row).toLowerCase().indexOf(q) !== -1;
    });

    renderCrudTable(menuObj.entity, filtered);
  }

  function renderCrudTable(entity, rows) {
    const thead = $('crud-table-head');
    const tbody = $('crud-table-body');
    const emptyEl = $('crud-empty-state');

    const columnsMap = {
      Master_Konfigurasi: [
        { key: 'tipe_config', label: 'Tipe' },
        { key: 'kode', label: 'Kode' },
        { key: 'label', label: 'Label Tampilan' },
        { key: 'parent_kode', label: 'Induk' },
        { key: 'status_aktif', label: 'Status', isStatus: true }
      ],
      Sekolah: [
        { key: 'sekolah_id', label: 'ID Sekolah' },
        { key: 'nama_sekolah', label: 'Nama Sekolah' },
        { key: 'kecamatan', label: 'Kecamatan' },
        { key: 'jenjang', label: 'Jenjang' },
        { key: 'status_aktif', label: 'Status', isStatus: true }
      ],
      Users: [
        { key: 'username', label: 'Username / NISN' },
        { key: 'nama_lengkap', label: 'Nama Lengkap' },
        { key: 'role', label: 'Peran' },
        { key: 'kelas', label: 'Kelas' },
        { key: 'sekolah_id', label: 'Sekolah', format: resolveSekolahName },
        { key: 'status', label: 'Status', isStatus: true }
      ],
      Paket_Ujian: [
        { key: 'nama_ujian', label: 'Nama Paket Ujian' },
        { key: 'kategori_kode', label: 'Kategori', format: resolveConfigLabel },
        { key: 'mapel_kode', label: 'Mata Pelajaran', format: resolveConfigLabel },
        { key: 'kelas', label: 'Kelas' },
        { key: 'durasi_menit', label: 'Durasi (Mnt)' },
        { key: 'mode_penilaian', label: 'Penilaian' }
      ],
      Bank_Soal: [
        { key: 'no_urut', label: 'No' },
        { key: 'paket_id', label: 'Paket', format: function (id) {
          const p = state.paketList.find(function (x) { return String(x.paket_id) === String(id); });
          return p ? p.nama_ujian : id;
        }},
        { key: 'tipe_soal_kode', label: 'Bentuk Soal', format: getQuestionTypeLabel },
        { key: 'lingkup_materi_kode', label: 'Lingkup Materi', format: resolveConfigLabel },
        { key: 'pertanyaan', label: 'Pertanyaan' }
      ],
      Jadwal_Ujian: [
        { key: 'paket_id', label: 'Paket Ujian', format: function (id) {
          const p = state.paketList.find(function (x) { return String(x.paket_id) === String(id); });
          return p ? p.nama_ujian : id;
        }},
        { key: 'sekolah_id', label: 'Sekolah', format: resolveSekolahName },
        { key: 'waktu_mulai', label: 'Mulai', format: EduDashboard.formatWaktuSingkat },
        { key: 'token_ujian', label: 'Token' },
        { key: 'status', label: 'Status', isStatus: true }
      ],
      Hasil_Ujian: [
        { key: 'nama_siswa', label: 'Nama Peserta' },
        { key: 'username_siswa', label: 'NISN / Username' },
        { key: 'kelas_siswa', label: 'Kelas' },
        { key: 'nama_paket', label: 'Paket Asesmen' },
        { key: 'skor_akhir', label: 'Skor Akademik' },
        { key: 'skor_survei', label: 'Indeks Survei', format: function (v) { return v !== null && v !== undefined && v !== '' ? v + '%' : '-'; } },
        { key: 'status_pengerjaan', label: 'Status', isStatus: true }
      ]
    };

    const cols = columnsMap[entity] || [];
    thead.innerHTML =
      '<tr>' +
      cols.map(function (c) { return '<th>' + EduDashboard.escapeHtml(c.label) + '</th>'; }).join('') +
      '<th class="no-print">Aksi</th></tr>';

    if (!rows || rows.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      refreshIcons();
      return;
    }

    emptyEl.classList.add('hidden');
    const idFieldMap = {
      Master_Konfigurasi: 'config_id',
      Sekolah: 'sekolah_id',
      Users: 'user_id',
      Paket_Ujian: 'paket_id',
      Bank_Soal: 'soal_id',
      Jadwal_Ujian: 'jadwal_id',
      Hasil_Ujian: 'hasil_id'
    };
    const idField = idFieldMap[entity];

    tbody.innerHTML = rows
      .map(function (row) {
        const recId = EduDashboard.escapeHtml(row[idField]);
        const cells = cols
          .map(function (c) {
            const rawVal = row[c.key];
            const displayVal = c.format ? c.format(rawVal) : (rawVal !== undefined && rawVal !== '' ? rawVal : '-');
            if (c.isStatus) {
              return '<td><span class="status-badge ' + EduDashboard.getStatusClass(displayVal) + '">' + EduDashboard.escapeHtml(displayVal) + '</span></td>';
            }
            const truncated = String(displayVal).length > 75 ? String(displayVal).slice(0, 75) + '...' : displayVal;
            return '<td>' + EduDashboard.escapeHtml(truncated) + '</td>';
          })
          .join('');

        const isGuruRole = String(state.user.role || '').toLowerCase() === 'guru';
        const isExamInProgress = entity === 'Hasil_Ujian' && String(row.status_pengerjaan || '').toUpperCase() !== 'SELESAI';
        const actionButtons = entity === 'Hasil_Ujian'
          ? (isExamInProgress
              ? '<button type="button" class="btn-outline-sm" data-force-finish-id="' + recId + '">Paksa Selesai</button> '
              : '') +
            '<button type="button" class="btn-edit-sm" data-report-id="' + recId + '">Laporan & Analisis</button> ' +
            '<button type="button" class="btn-danger-sm" data-del-id="' + recId + '">Reset</button>'
          : (entity === 'Jadwal_Ujian' && isGuruRole)
          ? '<span class="badge-soft-slate">Info Admin</span>'
          : (entity === 'Paket_Ujian'
              ? '<button type="button" class="btn-outline-sm" data-preview-paket-id="' + recId + '">Pratinjau</button> '
              : '') +
            (entity === 'Users' && String(row.role).toLowerCase() !== 'admin'
              ? '<button type="button" class="btn-outline-sm" data-card-id="' + recId + '">Kartu</button> '
              : '') +
            '<button type="button" class="btn-edit-sm" data-edit-id="' + recId + '">Edit</button> ' +
            '<button type="button" class="btn-danger-sm" data-del-id="' + recId + '">Hapus</button>';

        return '<tr>' + cells + '<td class="no-print" style="white-space:nowrap;">' + actionButtons + '</td></tr>';
      })
      .join('');

    tbody.querySelectorAll('[data-force-finish-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const hasilId = btn.getAttribute('data-force-finish-id');
        openModal(
          'Konfirmasi Paksa Selesai Ujian',
          '<p>Sesi pengerjaan siswa akan ditutup secara paksa dan dinilai otomatis menggunakan <strong>jawaban terakhir yang tersinkron di server</strong>.</p>' +
          '<p style="margin-top:8px;color:#475569;">Lanjutkan menutup sesi ujian ini?</p>',
          'Ya, Paksa Selesai',
          async function () {
            closeModal();
            showLoader('Menutup sesi dan menghitung nilai...');
            try {
              const res = await EduApi.forceFinishExamSession(hasilId);
              showToast('Sesi ditutup. Skor akhir: ' + res.skor_akhir, 'success');
              const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
              const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
              if (activeMenu) {
                await loadCrudModule(activeMenu);
              }
            } catch (err) {
              showToast(err.message, 'error');
            } finally {
              hideLoader();
            }
          }
        );
      });
    });

    tbody.querySelectorAll('[data-preview-paket-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openStudentPreviewModal(btn.getAttribute('data-preview-paket-id'));
      });
    });

    tbody.querySelectorAll('[data-report-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const hasilId = btn.getAttribute('data-report-id');
        EduReport.openStudentReportModal(hasilId, {
          openModal: openModal,
          closeModal: closeModal,
          showLoader: showLoader,
          hideLoader: hideLoader,
          showToast: showToast
        });
      });
    });

    tbody.querySelectorAll('[data-card-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const userId = btn.getAttribute('data-card-id');
        const foundUser = state.crudRecords.find(function (r) { return String(r.user_id) === String(userId); });
        if (foundUser) {
          EduReport.printAccountCards([foundUser], resolveSekolahName);
        }
      });
    });

    tbody.querySelectorAll('[data-edit-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idVal = btn.getAttribute('data-edit-id');
        const found = state.crudRecords.find(function (r) { return String(r[idField]) === String(idVal); });
        if (found) {
          openEntityFormModal(entity, found);
        }
      });
    });

    tbody.querySelectorAll('[data-del-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idVal = btn.getAttribute('data-del-id');
        openModal(
          'Konfirmasi Hapus Data',
          '<p>Apakah Anda yakin ingin menghapus data dengan ID <strong>' + EduDashboard.escapeHtml(idVal) + '</strong>?</p>',
          'Ya, Hapus',
          async function () {
            closeModal();
            showLoader('Menghapus data...');
            try {
              await EduApi.saveEntityRecord(entity, 'delete', { id: idVal });
              if (entity === 'Master_Konfigurasi' || entity === 'Sekolah') {
                EduApi.invalidateMasterConfigCache();
              }
              showToast('Data berhasil dihapus.', 'success');
              const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
              const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
              if (activeMenu) {
                await loadCrudModule(activeMenu);
              }
            } catch (err) {
              showToast(err.message, 'error');
            } finally {
              hideLoader();
            }
          }
        );
      });
    });

    refreshIcons();
  }

  function openEntityFormModal(entity, existingRecord) {
    const isEdit = Boolean(existingRecord);
    const rec = existingRecord || {};

    if (entity === 'Master_Konfigurasi') {
      const html =
        '<div class="form-grid">' +
          '<div class="form-group"><label>Tipe Konfigurasi</label><select id="f-tipe_config" class="form-control">' +
            '<option value="KATEGORI_UJIAN"' + (rec.tipe_config === 'KATEGORI_UJIAN' ? ' selected' : '') + '>Kategori Ujian (TKA / Survei / Sulingjar)</option>' +
            '<option value="MAPEL"' + (rec.tipe_config === 'MAPEL' ? ' selected' : '') + '>Mata Pelajaran</option>' +
            '<option value="ELEMEN"' + (rec.tipe_config === 'ELEMEN' ? ' selected' : '') + '>Elemen (Induk Laporan - Tingkat 1)</option>' +
            '<option value="SUB_ELEMEN"' + (rec.tipe_config === 'SUB_ELEMEN' ? ' selected' : '') + '>Sub-Elemen (Tingkat 2)</option>' +
            '<option value="LINGKUP_MATERI"' + (rec.tipe_config === 'LINGKUP_MATERI' ? ' selected' : '') + '>Kompetensi / Deskripsi Indikator (Tingkat 3)</option>' +
            '<option value="TIPE_SOAL"' + (rec.tipe_config === 'TIPE_SOAL' ? ' selected' : '') + '>Bentuk / Tipe Soal</option>' +
          '</select></div>' +
          '<div class="form-group"><label>Kode Unik (Huruf Kapital)</label><input id="f-kode" class="form-control" value="' + EduDashboard.escapeHtml(rec.kode || '') + '" placeholder="Misal: ELM_BIL / SUB_RAS / IND_01" /></div>' +
          '<div class="form-group full"><label>Label Tampilan / Deskripsi Kompetensi</label><input id="f-label" class="form-control" value="' + EduDashboard.escapeHtml(rec.label || '') + '" placeholder="Misal: Bilangan / Bilangan Rasional / Kemampuan memahami..." /></div>' +
          '<div class="form-group"><label>Kode Induk (Parent Kode)</label><input id="f-parent_kode" class="form-control" value="' + EduDashboard.escapeHtml(rec.parent_kode || '') + '" placeholder="Misal: MTK -> ELM_BIL -> SUB_RAS" /></div>' +
          '<div class="form-group"><label>Status</label><select id="f-status_aktif" class="form-control">' +
            '<option value="AKTIF"' + (rec.status_aktif !== 'NONAKTIF' ? ' selected' : '') + '>AKTIF</option>' +
            '<option value="NONAKTIF"' + (rec.status_aktif === 'NONAKTIF' ? ' selected' : '') + '>NONAKTIF</option>' +
          '</select></div>' +
        '</div>';

      openModal(isEdit ? 'Edit Konfigurasi' : 'Tambah Konfigurasi Baru', html, 'Simpan', async function () {
        const payload = {
          config_id: rec.config_id || '',
          tipe_config: $('f-tipe_config').value,
          kode: $('f-kode').value.trim().toUpperCase(),
          label: $('f-label').value.trim(),
          parent_kode: $('f-parent_kode').value.trim().toUpperCase(),
          status_aktif: $('f-status_aktif').value
        };
        if (!payload.kode || !payload.label) {
          showToast('Kode dan label wajib diisi.', 'warning');
          return;
        }
        await submitCrudSave(entity, isEdit ? 'update' : 'create', payload);
      });
      return;
    }

    if (entity === 'Sekolah') {
      const html =
        '<div class="form-grid">' +
          '<div class="form-group"><label>Kode / ID Sekolah (NPSN)</label><input id="f-sekolah_id" class="form-control" value="' + EduDashboard.escapeHtml(rec.sekolah_id || '') + '"' + (isEdit ? ' readonly' : '') + ' placeholder="Misal: SDN3DLEPIH" /></div>' +
          '<div class="form-group"><label>Jenjang</label><input id="f-jenjang" class="form-control" value="' + EduDashboard.escapeHtml(rec.jenjang || 'SD') + '" /></div>' +
          '<div class="form-group full"><label>Nama Sekolah</label><input id="f-nama_sekolah" class="form-control" value="' + EduDashboard.escapeHtml(rec.nama_sekolah || '') + '" placeholder="Misal: SD Negeri 3 Dlepih" /></div>' +
          '<div class="form-group"><label>Kecamatan</label><input id="f-kecamatan" class="form-control" value="' + EduDashboard.escapeHtml(rec.kecamatan || '') + '" /></div>' +
          '<div class="form-group"><label>Status</label><select id="f-status_aktif" class="form-control">' +
            '<option value="AKTIF">AKTIF</option><option value="NONAKTIF"' + (rec.status_aktif === 'NONAKTIF' ? ' selected' : '') + '>NONAKTIF</option>' +
          '</select></div>' +
        '</div>';

      openModal(isEdit ? 'Edit Sekolah' : 'Tambah Sekolah', html, 'Simpan', async function () {
        const payload = {
          sekolah_id: $('f-sekolah_id').value.trim(),
          nama_sekolah: $('f-nama_sekolah').value.trim(),
          kecamatan: $('f-kecamatan').value.trim(),
          jenjang: $('f-jenjang').value.trim() || 'SD',
          status_aktif: $('f-status_aktif').value
        };
        if (!payload.nama_sekolah) {
          showToast('Nama sekolah wajib diisi.', 'warning');
          return;
        }
        await submitCrudSave(entity, isEdit ? 'update' : 'create', payload);
      });
      return;
    }

    if (entity === 'Users') {
      const isGuru = String(state.user.role).toLowerCase() === 'guru';
      const sekolahOptions = state.sekolahList
        .map(function (s) {
          const sel = String(rec.sekolah_id || state.user.sekolah_id) === String(s.sekolah_id) ? ' selected' : '';
          return '<option value="' + EduDashboard.escapeHtml(s.sekolah_id) + '"' + sel + '>' + EduDashboard.escapeHtml(s.nama_sekolah) + '</option>';
        })
        .join('');

      const html =
        '<div class="form-grid">' +
          '<div class="form-group"><label>Username / NISN</label><input id="f-username" class="form-control" value="' + EduDashboard.escapeHtml(rec.username || '') + '" /></div>' +
          '<div class="form-group"><label>Kata Sandi ' + (isEdit ? '(Kosongkan jika tetap)' : '') + '</label><input type="password" id="f-password" class="form-control" placeholder="Minimal 6 karakter" /></div>' +
          '<div class="form-group full"><label>Nama Lengkap</label><input id="f-nama_lengkap" class="form-control" value="' + EduDashboard.escapeHtml(rec.nama_lengkap || '') + '" /></div>' +
          '<div class="form-group"><label>Peran</label><select id="f-role" class="form-control"' + (isGuru ? ' disabled' : '') + '>' +
            '<option value="siswa"' + (rec.role === 'siswa' ? ' selected' : '') + '>Siswa</option>' +
            '<option value="guru"' + (rec.role === 'guru' ? ' selected' : '') + '>Guru</option>' +
            '<option value="admin"' + (rec.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
          '</select></div>' +
          '<div class="form-group"><label>Kelas</label><input id="f-kelas" class="form-control" value="' + EduDashboard.escapeHtml(rec.kelas || '') + '" placeholder="Misal: 5 atau 6" /></div>' +
          '<div class="form-group full"><label>Sekolah</label><select id="f-sekolah_id" class="form-control"' + (isGuru ? ' disabled' : '') + '>' +
            '<option value="">-- Pilih Sekolah --</option>' + sekolahOptions +
          '</select></div>' +
        '</div>';

      openModal(isEdit ? 'Edit Pengguna' : 'Tambah Pengguna', html, 'Simpan', async function () {
        const payload = {
          user_id: rec.user_id || '',
          username: $('f-username').value.trim(),
          password: $('f-password').value,
          nama_lengkap: $('f-nama_lengkap').value.trim(),
          role: isGuru ? 'siswa' : $('f-role').value,
          kelas: $('f-kelas').value.trim(),
          sekolah_id: isGuru ? state.user.sekolah_id : $('f-sekolah_id').value,
          status: 'AKTIF'
        };
        if (!payload.username || !payload.nama_lengkap) {
          showToast('Username dan nama lengkap wajib diisi.', 'warning');
          return;
        }
        await submitCrudSave(entity, isEdit ? 'update' : 'create', payload);
      });
      return;
    }

    if (entity === 'Paket_Ujian') {
      const katOpts = getConfigByType('KATEGORI_UJIAN')
        .map(function (c) {
          return '<option value="' + EduDashboard.escapeHtml(c.kode) + '"' + (rec.kategori_kode === c.kode ? ' selected' : '') + '>' + EduDashboard.escapeHtml(c.label) + '</option>';
        })
        .join('');
      const mapelOpts = getConfigByType('MAPEL')
        .map(function (c) {
          return '<option value="' + EduDashboard.escapeHtml(c.kode) + '"' + (rec.mapel_kode === c.kode ? ' selected' : '') + '>' + EduDashboard.escapeHtml(c.label) + '</option>';
        })
        .join('');

      const html =
        '<div class="form-grid">' +
          '<div class="form-group full"><label>Nama Paket Ujian</label><input id="f-nama_ujian" class="form-control" value="' + EduDashboard.escapeHtml(rec.nama_ujian || '') + '" placeholder="Misal: Tryout TKA 1 - Matematika" /></div>' +
          '<div class="form-group"><label>Kategori Asesmen (Dari Pengaturan Sistem)</label><select id="f-kategori_kode" class="form-control">' + katOpts + '</select></div>' +
          '<div class="form-group"><label>Mata Pelajaran / Instrumen</label><select id="f-mapel_kode" class="form-control">' + mapelOpts + '</select></div>' +
          '<div class="form-group"><label>Kelas Target</label><input id="f-kelas" class="form-control" value="' + EduDashboard.escapeHtml(rec.kelas || '') + '" placeholder="Misal: 5 / 6 / Semua" /></div>' +
          '<div class="form-group"><label>Durasi (Menit)</label><input type="number" id="f-durasi_menit" class="form-control" value="' + EduDashboard.escapeHtml(rec.durasi_menit || 60) + '" /></div>' +
          '<div class="form-group full"><label>Mode Penilaian</label><select id="f-mode_penilaian" class="form-control">' +
            '<option value="AKADEMIK"' + (rec.mode_penilaian === 'AKADEMIK' ? ' selected' : '') + '>Skor Akademik Murni (0 - 100)</option>' +
            '<option value="KOMBINASI"' + (rec.mode_penilaian === 'KOMBINASI' ? ' selected' : '') + '>Kombinasi (Akademik + Survei Karakter / Sulingjar dalam 1 Paket)</option>' +
            '<option value="SURVEI"' + (rec.mode_penilaian === 'SURVEI' ? ' selected' : '') + '>Survei Murni (Karakter / Sulingjar)</option>' +
          '</select></div>' +
        '</div>';

      openModal(isEdit ? 'Edit Paket Ujian' : 'Buat Paket Ujian', html, 'Simpan', async function () {
        const payload = {
          paket_id: rec.paket_id || '',
          nama_ujian: $('f-nama_ujian').value.trim(),
          kategori_kode: $('f-kategori_kode').value,
          mapel_kode: $('f-mapel_kode').value,
          kelas: $('f-kelas').value.trim(),
          durasi_menit: Number($('f-durasi_menit').value) || 60,
          mode_penilaian: $('f-mode_penilaian').value,
          status: 'AKTIF'
        };
        if (!payload.nama_ujian) {
          showToast('Nama paket ujian wajib diisi.', 'warning');
          return;
        }
        await submitCrudSave(entity, isEdit ? 'update' : 'create', payload);
      });
      return;
    }

    if (entity === 'Jadwal_Ujian') {
      const isGuru = String(state.user.role).toLowerCase() === 'guru';
      const pktOpts = state.paketList
        .map(function (p) {
          return '<option value="' + EduDashboard.escapeHtml(p.paket_id) + '"' + (rec.paket_id === p.paket_id ? ' selected' : '') + '>' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
        })
        .join('');
      const sekOpts = '<option value="SEMUA">Semua Sekolah</option>' + state.sekolahList
        .map(function (s) {
          const sel = String(rec.sekolah_id || (isGuru ? state.user.sekolah_id : '')) === String(s.sekolah_id) ? ' selected' : '';
          return '<option value="' + EduDashboard.escapeHtml(s.sekolah_id) + '"' + sel + '>' + EduDashboard.escapeHtml(s.nama_sekolah) + '</option>';
        })
        .join('');

      const html =
        '<div class="form-grid">' +
          '<div class="form-group full"><label>Pilih Paket Ujian</label><select id="f-paket_id" class="form-control">' + pktOpts + '</select></div>' +
          '<div class="form-group"><label>Sekolah Sasaran</label><select id="f-sekolah_id" class="form-control"' + (isGuru ? ' disabled' : '') + '>' + sekOpts + '</select></div>' +
          '<div class="form-group"><label>Peran Peserta</label><select id="f-target_role" class="form-control">' +
            '<option value="siswa"' + (rec.target_role !== 'guru' ? ' selected' : '') + '>Siswa</option>' +
            '<option value="guru"' + (rec.target_role === 'guru' ? ' selected' : '') + '>Guru (Sulingjar Guru)</option>' +
          '</select></div>' +
          '<div class="form-group"><label>Waktu Mulai</label><input type="datetime-local" id="f-waktu_mulai" class="form-control" value="' + EduDashboard.escapeHtml(rec.waktu_mulai ? String(rec.waktu_mulai).slice(0, 16) : '') + '" /></div>' +
          '<div class="form-group"><label>Waktu Selesai</label><input type="datetime-local" id="f-waktu_selesai" class="form-control" value="' + EduDashboard.escapeHtml(rec.waktu_selesai ? String(rec.waktu_selesai).slice(0, 16) : '') + '" /></div>' +
          '<div class="form-group"><label>Token Ujian (Opsional)</label><input id="f-token_ujian" class="form-control" value="' + EduDashboard.escapeHtml(rec.token_ujian || '') + '" placeholder="Kosongkan jika tanpa token" /></div>' +
          '<div class="form-group"><label>Status Jadwal</label><select id="f-status" class="form-control">' +
            '<option value="Aktif"' + (rec.status === 'Aktif' ? ' selected' : '') + '>Aktif</option>' +
            '<option value="Terjadwal"' + (rec.status === 'Terjadwal' ? ' selected' : '') + '>Terjadwal</option>' +
            '<option value="Selesai"' + (rec.status === 'Selesai' ? ' selected' : '') + '>Selesai</option>' +
          '</select></div>' +
        '</div>';

      openModal(isEdit ? 'Edit Jadwal Ujian' : 'Buat Jadwal Ujian', html, 'Simpan Jadwal', async function () {
        const payload = {
          jadwal_id: rec.jadwal_id || '',
          paket_id: $('f-paket_id').value,
          sekolah_id: isGuru ? state.user.sekolah_id : $('f-sekolah_id').value,
          target_role: $('f-target_role').value,
          waktu_mulai: $('f-waktu_mulai').value ? new Date($('f-waktu_mulai').value).toISOString() : '',
          waktu_selesai: $('f-waktu_selesai').value ? new Date($('f-waktu_selesai').value).toISOString() : '',
          token_ujian: $('f-token_ujian').value.trim().toUpperCase(),
          status: $('f-status').value
        };
        await submitCrudSave(entity, isEdit ? 'update' : 'create', payload);
      });
      return;
    }

    if (entity === 'Bank_Soal') {
      openQuestionBuilderModal(isEdit, rec);
    }
  }

  function openQuestionBuilderModal(isEdit, rec) {
    const pktOpts = state.paketList
      .map(function (p) {
        return '<option value="' + EduDashboard.escapeHtml(p.paket_id) + '"' + (rec.paket_id === p.paket_id ? ' selected' : '') + '>' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
      })
      .join('');

    const hierarchyConfigs = (state.masterConfig || []).filter(function (c) {
      const t = String(c.tipe_config || '').toUpperCase();
      return t === 'LINGKUP_MATERI' || t === 'SUB_ELEMEN' || t === 'ELEMEN';
    });

    const materiOpts = '<option value="">-- Umum / Tanpa Pemetaan --</option>' + hierarchyConfigs
      .map(function (m) {
        const parentHint = m.parent_kode ? ' [' + resolveConfigLabel(m.parent_kode) + ']' : '';
        return '<option value="' + EduDashboard.escapeHtml(m.kode) + '"' + (rec.lingkup_materi_kode === m.kode ? ' selected' : '') + '>' +
          EduDashboard.escapeHtml(m.label + parentHint) +
        '</option>';
      })
      .join('');

    const currentTipe = rec.tipe_soal_kode || 'PG';
    const initialImgUrl = normalizeDriveImageUrl(rec.stimulus_gambar_url || '');

    const html =
      '<div class="form-grid">' +
        '<div class="form-group"><label>Paket Ujian</label><select id="q-paket_id" class="form-control">' + pktOpts + '</select></div>' +
        '<div class="form-group"><label>Nomor Urut</label><input type="number" id="q-no_urut" class="form-control" value="' + EduDashboard.escapeHtml(rec.no_urut || (state.crudRecords.length + 1)) + '" /></div>' +
        '<div class="form-group"><label>Bentuk / Tipe Soal</label><select id="q-tipe_soal_kode" class="form-control">' +
          '<option value="PG"' + (currentTipe === 'PG' ? ' selected' : '') + '>Pilihan Ganda (PG)</option>' +
          '<option value="PGK_MCMA"' + (currentTipe === 'PGK_MCMA' ? ' selected' : '') + '>PG Kompleks - Jawaban Ganda (MCMA)</option>' +
          '<option value="PGK_BS"' + (currentTipe === 'PGK_BS' ? ' selected' : '') + '>PG Kompleks - Benar / Salah</option>' +
          '<option value="SURVEI"' + (currentTipe === 'SURVEI' ? ' selected' : '') + '>Skala Survei (Karakter / Sulingjar)</option>' +
        '</select></div>' +
        '<div class="form-group"><label>Lingkup Materi / Dimensi</label><select id="q-lingkup_materi_kode" class="form-control">' + materiOpts + '</select></div>' +
        '<div class="form-group full"><label>Stimulus / Bacaan Cerita (Opsional)</label><textarea id="q-stimulus_teks" class="form-control" rows="2">' + EduDashboard.escapeHtml(rec.stimulus_teks || '') + '</textarea></div>' +
        '<div class="form-group full">' +
          '<label>Gambar Ilustrasi Soal (Link Google Drive Otomatis / Unggah & Kompres WebP)</label>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input id="q-stimulus_gambar_url" class="form-control" value="' + EduDashboard.escapeHtml(initialImgUrl) + '" placeholder="Tempel link Google Drive biasa atau pilih gambar..." />' +
            '<button type="button" id="btn-q-pick-image" class="btn-outline" style="white-space:nowrap;"><i data-lucide="image"></i><span>Pilih & Kompres</span></button>' +
            '<input type="file" id="q-image-file-input" accept="image/*" class="hidden" />' +
          '</div>' +
          '<div id="q-image-preview-box" class="' + (initialImgUrl ? '' : 'hidden') + '" style="margin-top:8px;padding:8px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;background:#f8fafc;">' +
            '<img id="q-image-preview-img" src="' + EduDashboard.escapeHtml(initialImgUrl) + '" alt="Pratinjau Gambar" style="max-height:140px;max-width:100%;border-radius:6px;" />' +
            '<div id="q-image-preview-info" style="font-size:0.78rem;color:#475569;margin-top:4px;">Pratinjau gambar soal aktif</div>' +
          '</div>' +
        '</div>' +
        '<div class="form-group full"><label>Pertanyaan</label><textarea id="q-pertanyaan" class="form-control" rows="2">' + EduDashboard.escapeHtml(rec.pertanyaan || '') + '</textarea></div>' +
        '<div id="q-dynamic-builder" class="form-group full"></div>' +
      '</div>';

    openModal(isEdit ? 'Edit Butir Soal' : 'Tambah Butir Soal', html, 'Simpan Soal', async function () {
      const built = extractQuestionBuilderData($('q-tipe_soal_kode').value, $('q-lingkup_materi_kode').value);
      const normalizedImg = normalizeDriveImageUrl($('q-stimulus_gambar_url').value);
      const payload = {
        soal_id: rec.soal_id || '',
        paket_id: $('q-paket_id').value,
        no_urut: Number($('q-no_urut').value) || 1,
        tipe_soal_kode: $('q-tipe_soal_kode').value,
        lingkup_materi_kode: $('q-lingkup_materi_kode').value,
        stimulus_teks: $('q-stimulus_teks').value.trim(),
        stimulus_gambar_url: normalizedImg,
        pertanyaan: $('q-pertanyaan').value.trim(),
        opsi_json: JSON.stringify(built.opsi),
        kunci_json: JSON.stringify(built.kunci),
        bobot: 1
      };
      if (!payload.pertanyaan) {
        showToast('Pertanyaan wajib diisi.', 'warning');
        return;
      }
      await submitCrudSave('Bank_Soal', isEdit ? 'update' : 'create', payload);
    });

    const urlInput = $('q-stimulus_gambar_url');
    const previewBox = $('q-image-preview-box');
    const previewImg = $('q-image-preview-img');
    const previewInfo = $('q-image-preview-info');

    previewImg.addEventListener('load', function () {
      previewInfo.style.color = '#065f46';
      previewInfo.textContent = 'Pratinjau gambar berhasil dimuat';
    });

    previewImg.addEventListener('error', function () {
      const curSrc = String(previewImg.src || '');
      const thumbMatch = curSrc.match(/drive\.google\.com\/thumbnail\?id=([a-zA-Z0-9_-]+)/);
      if (thumbMatch && thumbMatch[1] && !previewImg.dataset.fallbackTried) {
        previewImg.dataset.fallbackTried = '1';
        const fallbackUrl = 'https://lh3.googleusercontent.com/d/' + thumbMatch[1] + '=w800';
        urlInput.value = fallbackUrl;
        previewImg.src = fallbackUrl;
        return;
      }
      previewInfo.style.color = '#b91c1c';
      previewInfo.textContent = 'Gambar gagal dimuat. Pastikan izin file di Google Drive diatur ke "Siapa saja yang memiliki link" (Pelihat).';
    });

    const handleUrlUpdate = function () {
      delete previewImg.dataset.fallbackTried;
      const converted = normalizeDriveImageUrl(urlInput.value);
      if (converted !== urlInput.value.trim()) {
        urlInput.value = converted;
        showToast('Link Google Drive otomatis dikonversi ke format gambar langsung.', 'info');
      }
      if (converted) {
        previewImg.src = converted;
        previewInfo.style.color = '#475569';
        previewInfo.textContent = 'Memuat pratinjau gambar...';
        previewBox.classList.remove('hidden');
      } else {
        previewBox.classList.add('hidden');
      }
    };

    urlInput.addEventListener('change', handleUrlUpdate);
    urlInput.addEventListener('input', handleUrlUpdate);

    $('btn-q-pick-image').addEventListener('click', function () {
      $('q-image-file-input').click();
    });

    $('q-image-file-input').addEventListener('change', async function (ev) {
      const file = ev.target.files && ev.target.files[0];
      if (!file) {
        return;
      }
      try {
        previewInfo.textContent = 'Mengompres gambar ke WebP...';
        previewBox.classList.remove('hidden');
        const compressed = await compressImageToWebpDataUrl(file);
        urlInput.value = compressed.dataUrl;
        previewImg.src = compressed.dataUrl;
        previewInfo.textContent = 'Terkompresi otomatis (' + compressed.sizeKb + ' KB • WebP siap simpan)';
        showToast('Gambar berhasil dikompres menjadi ' + compressed.sizeKb + ' KB.', 'success');
      } catch (err) {
        previewBox.classList.add('hidden');
        showToast(err.message, 'error');
      }
    });

    const renderBuilderFields = function () {
      const tipe = $('q-tipe_soal_kode').value;
      const box = $('q-dynamic-builder');
      let parsedOpsi = null;
      let parsedKunci = null;
      try {
        parsedOpsi = rec.opsi_json ? JSON.parse(rec.opsi_json) : null;
        parsedKunci = rec.kunci_json ? JSON.parse(rec.kunci_json) : null;
      } catch (e) {
        parsedOpsi = null;
      }

      if (tipe === 'PG') {
        const list = Array.isArray(parsedOpsi) ? parsedOpsi : [
          { id: 'A', teks: '' }, { id: 'B', teks: '' }, { id: 'C', teks: '' }, { id: 'D', teks: '' }
        ];
        const keyVal = parsedKunci && parsedKunci.jawaban ? parsedKunci.jawaban : 'A';
        box.innerHTML =
          '<label>Opsi Jawaban (A - D)</label>' +
          list.map(function (o) {
            return '<input class="form-control qb-pg-opt" data-oid="' + o.id + '" style="margin-bottom:6px;" placeholder="Opsi ' + o.id + '" value="' + EduDashboard.escapeHtml(o.teks || '') + '" />';
          }).join('') +
          '<label style="margin-top:6px;">Kunci Jawaban Benar</label>' +
          '<select id="qb-pg-key" class="form-control">' +
            list.map(function (o) {
              return '<option value="' + o.id + '"' + (keyVal === o.id ? ' selected' : '') + '>' + o.id + '</option>';
            }).join('') +
          '</select>';
      } else if (tipe === 'PGK_MCMA') {
        const list = Array.isArray(parsedOpsi) ? parsedOpsi : [
          { id: '1', teks: '' }, { id: '2', teks: '' }, { id: '3', teks: '' }, { id: '4', teks: '' }
        ];
        const keyArr = parsedKunci && Array.isArray(parsedKunci.jawaban) ? parsedKunci.jawaban : [];
        box.innerHTML =
          '<label>Pilihan Jawaban (Centang semua yang benar)</label>' +
          list.map(function (o) {
            const chk = keyArr.indexOf(String(o.id)) !== -1 ? ' checked' : '';
            return (
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
                '<input type="checkbox" class="qb-mcma-chk" value="' + o.id + '"' + chk + ' />' +
                '<input class="form-control qb-mcma-opt" data-oid="' + o.id + '" placeholder="Pernyataan ' + o.id + '" value="' + EduDashboard.escapeHtml(o.teks || '') + '" />' +
              '</div>'
            );
          }).join('');
      } else if (tipe === 'PGK_BS') {
        const rows = parsedOpsi && Array.isArray(parsedOpsi.baris) ? parsedOpsi.baris : [
          { id: 'P1', teks: '' }, { id: 'P2', teks: '' }, { id: 'P3', teks: '' }
        ];
        const keyMap = parsedKunci && parsedKunci.jawaban ? parsedKunci.jawaban : {};
        box.innerHTML =
          '<label>Daftar Pernyataan & Kunci (Benar / Salah)</label>' +
          rows.map(function (r) {
            const cur = keyMap[r.id] || 'Benar';
            return (
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
                '<input class="form-control qb-bs-text" data-rid="' + r.id + '" placeholder="Teks pernyataan ' + r.id + '" value="' + EduDashboard.escapeHtml(r.teks || '') + '" />' +
                '<select class="form-control qb-bs-key" data-rid="' + r.id + '" style="width:130px;">' +
                  '<option value="Benar"' + (cur === 'Benar' ? ' selected' : '') + '>Benar</option>' +
                  '<option value="Salah"' + (cur === 'Salah' ? ' selected' : '') + '>Salah</option>' +
                '</select>' +
              '</div>'
            );
          }).join('');
      } else if (tipe === 'SURVEI') {
        const list = Array.isArray(parsedOpsi) ? parsedOpsi : [
          { id: '1', teks: 'Sangat Tidak Setuju', skor: 1 },
          { id: '2', teks: 'Tidak Setuju', skor: 2 },
          { id: '3', teks: 'Setuju', skor: 3 },
          { id: '4', teks: 'Sangat Setuju', skor: 4 }
        ];
        const arah = parsedKunci && parsedKunci.arah ? parsedKunci.arah : 'POSITIF';
        box.innerHTML =
          '<label>Label Skala Respons Survei (Skor 1 - 4)</label>' +
          list.map(function (o) {
            return '<input class="form-control qb-srv-opt" data-oid="' + o.id + '" data-skor="' + o.skor + '" style="margin-bottom:6px;" value="' + EduDashboard.escapeHtml(o.teks || '') + '" />';
          }).join('') +
          '<label style="margin-top:6px;">Arah Pernyataan Survei</label>' +
          '<select id="qb-srv-arah" class="form-control">' +
            '<option value="POSITIF"' + (arah === 'POSITIF' ? ' selected' : '') + '>Positif (Skor Tinggi = Baik)</option>' +
            '<option value="NEGATIF"' + (arah === 'NEGATIF' ? ' selected' : '') + '>Negatif / Favorable Terbalik</option>' +
          '</select>';
      }
    };

    renderBuilderFields();
    $('q-tipe_soal_kode').addEventListener('change', renderBuilderFields);
  }

  function extractQuestionBuilderData(tipe, dimensiKode) {
    if (tipe === 'PG') {
      const opsi = [];
      document.querySelectorAll('.qb-pg-opt').forEach(function (inp) {
        opsi.push({ id: inp.getAttribute('data-oid'), teks: inp.value.trim() });
      });
      return {
        opsi: opsi,
        kunci: { jawaban: $('qb-pg-key').value }
      };
    }

    if (tipe === 'PGK_MCMA') {
      const opsi = [];
      const jawaban = [];
      document.querySelectorAll('.qb-mcma-opt').forEach(function (inp) {
        opsi.push({ id: inp.getAttribute('data-oid'), teks: inp.value.trim() });
      });
      document.querySelectorAll('.qb-mcma-chk:checked').forEach(function (chk) {
        jawaban.push(chk.value);
      });
      return {
        opsi: opsi,
        kunci: { jawaban: jawaban, mode_skor: 'PROPORSIONAL' }
      };
    }

    if (tipe === 'PGK_BS') {
      const baris = [];
      const jawaban = {};
      document.querySelectorAll('.qb-bs-text').forEach(function (inp) {
        const rid = inp.getAttribute('data-rid');
        if (inp.value.trim()) {
          baris.push({ id: rid, teks: inp.value.trim() });
          const sel = document.querySelector('.qb-bs-key[data-rid="' + rid + '"]');
          jawaban[rid] = sel ? sel.value : 'Benar';
        }
      });
      return {
        opsi: { kolom: ['Benar', 'Salah'], baris: baris },
        kunci: { jawaban: jawaban, mode_skor: 'PROPORSIONAL' }
      };
    }

    const opsiSrv = [];
    document.querySelectorAll('.qb-srv-opt').forEach(function (inp) {
      opsiSrv.push({
        id: inp.getAttribute('data-oid'),
        teks: inp.value.trim(),
        skor: Number(inp.getAttribute('data-skor')) || 1
      });
    });
    return {
      opsi: opsiSrv,
      kunci: { dimensi: dimensiKode || 'UMUM', arah: $('qb-srv-arah').value }
    };
  }

  function parseImportedSoalRow(cols, paketId, fallbackNo) {
    const tipe = String(cols[1] || 'PG').trim().toUpperCase();
    const lingkup = String(cols[2] || '').trim().toUpperCase();
    const stimulusTeks = String(cols[3] || '').trim();
    const stimulusImg = normalizeDriveImageUrl(cols[4]);
    const pertanyaan = String(cols[5] || '').trim();
    const rawOpts = [cols[6], cols[7], cols[8], cols[9]].map(function (v) {
      return v !== undefined && v !== null ? String(v).trim() : '';
    });
    const kunciRaw = String(cols[10] || '').trim();
    const bobot = Number(cols[11]) > 0 ? Number(cols[11]) : 1;

    let opsiObj = [];
    let kunciObj = {};

    if (tipe === 'PG') {
      const letters = ['A', 'B', 'C', 'D'];
      opsiObj = letters.map(function (ltr, idx) {
        return { id: ltr, teks: rawOpts[idx] || '' };
      });
      kunciObj = { jawaban: (kunciRaw || 'A').toUpperCase() };
    } else if (tipe === 'PGK_MCMA') {
      opsiObj = rawOpts
        .map(function (txt, idx) {
          return { id: String(idx + 1), teks: txt };
        })
        .filter(function (o) {
          return o.teks !== '';
        });
      const ansArr = kunciRaw
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      kunciObj = { jawaban: ansArr, mode_skor: 'PROPORSIONAL' };
    } else if (tipe === 'PGK_BS') {
      const baris = [];
      const ansMap = {};
      const keyParts = kunciRaw.split(',').map(function (s) {
        return s.trim();
      });
      rawOpts.forEach(function (txt, idx) {
        if (txt !== '') {
          const pid = 'P' + (idx + 1);
          baris.push({ id: pid, teks: txt });
          const rawAns = String(keyParts[idx] || 'Benar').toLowerCase();
          ansMap[pid] = rawAns === 'salah' || rawAns === 's' ? 'Salah' : 'Benar';
        }
      });
      opsiObj = { kolom: ['Benar', 'Salah'], baris: baris };
      kunciObj = { jawaban: ansMap, mode_skor: 'PROPORSIONAL' };
    } else {
      const defaultSurvey = [
        { id: '1', teks: 'Sangat Tidak Setuju', skor: 1 },
        { id: '2', teks: 'Tidak Setuju', skor: 2 },
        { id: '3', teks: 'Setuju', skor: 3 },
        { id: '4', teks: 'Sangat Setuju', skor: 4 }
      ];
      const hasCustomLabels = rawOpts.some(function (t) {
        return t !== '';
      });
      opsiObj = hasCustomLabels
        ? rawOpts
            .map(function (t, i) {
              return { id: String(i + 1), teks: t, skor: i + 1 };
            })
            .filter(function (o) {
              return o.teks !== '';
            })
        : defaultSurvey;
      kunciObj = {
        dimensi: lingkup || 'UMUM',
        arah: kunciRaw.toUpperCase() === 'NEGATIF' ? 'NEGATIF' : 'POSITIF'
      };
    }

    return {
      paket_id: paketId,
      no_urut: Number(cols[0]) || fallbackNo,
      tipe_soal_kode: tipe,
      lingkup_materi_kode: lingkup,
      stimulus_teks: stimulusTeks,
      stimulus_gambar_url: stimulusImg,
      pertanyaan: pertanyaan,
      opsi_json: JSON.stringify(opsiObj),
      kunci_json: JSON.stringify(kunciObj),
      bobot: bobot
    };
  }

  function openBatchImportModal(entity) {
    const isUsers = entity === 'Users';
    const isSoal = entity === 'Bank_Soal';
    let parsedFileMatrix = null;

    if (isSoal && (!state.paketList || state.paketList.length === 0)) {
      showToast('Buat minimal 1 Paket Ujian terlebih dahulu sebelum mengimpor soal.', 'warning');
      return;
    }

    const paketSelectHtml = isSoal
      ? '<div class="form-group"><label>Pilih Paket Ujian Tujuan</label><select id="batch-target-paket" class="form-control">' +
          state.paketList
            .map(function (p) {
              return '<option value="' + EduDashboard.escapeHtml(p.paket_id) + '">' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
            })
            .join('') +
        '</select></div>'
      : '';

    const guide = isSoal
      ? 'Unggah file <strong>Template_Impor_Massal_CBT_EduTryout.xlsx</strong> (sheet <em>Template_Bank_Soal</em>) atau tempel baris dari Excel.'
      : isUsers
      ? 'Unggah file <strong>Template_Impor_Massal_CBT_EduTryout.xlsx</strong> (sheet <em>Template_Data_Siswa</em>) atau tempel baris dari Excel.'
      : 'Unggah file Excel atau tempel baris data sekolah (ID Sekolah, Nama Sekolah, Kecamatan, Jenjang).';

    const modalTitle = isSoal
      ? 'Impor Massal Bank Soal'
      : isUsers
      ? 'Impor Massal Data Siswa'
      : 'Impor Massal Sekolah';

    const html =
      '<p style="font-size:0.86rem;color:#475569;">' + guide + '</p>' +
      paketSelectHtml +
      '<div class="form-group">' +
        '<label>Opsi 1: Pilih File Excel (.xlsx / .xls / .csv)</label>' +
        '<input type="file" id="batch-excel-file" accept=".xlsx,.xls,.csv" class="form-control" />' +
        '<small id="batch-file-status" style="color:#1d63ff;font-weight:600;"></small>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Opsi 2: Atau Tempel Langsung Baris dari Spreadsheet</label>' +
        '<textarea id="batch-paste-area" class="form-control" rows="6" placeholder="Tempel baris data dari Excel/Google Sheets di sini jika tidak mengunggah file..."></textarea>' +
      '</div>';

    openModal(modalTitle, html, 'Proses Impor', async function () {
      let matrix = parsedFileMatrix;
      if (!matrix) {
        const raw = $('batch-paste-area').value.trim();
        if (!raw) {
          showToast('Pilih file Excel atau tempel data terlebih dahulu.', 'warning');
          return;
        }
        matrix = raw
          .split(/\r?\n/)
          .filter(function (l) {
            return l.trim() !== '';
          })
          .map(function (line) {
            return line.split('\t');
          });
      }

      const targetPaketId = isSoal ? $('batch-target-paket').value : '';
      const records = [];

      matrix.forEach(function (cols, idx) {
        const c0 = String(cols[0] || '').trim().toLowerCase();
        const c1 = String(cols[1] || '').trim().toLowerCase();
        const c5 = String(cols[5] || '').trim().toLowerCase();

        if (idx === 0) {
          if (isUsers && (c0.indexOf('username') !== -1 || c0.indexOf('nisn') !== -1)) {
            return;
          }
          if (isSoal && (c0.indexOf('no_urut') !== -1 || c5 === 'pertanyaan')) {
            return;
          }
          if (!isUsers && !isSoal && (c0.indexOf('sekolah_id') !== -1 || c1.indexOf('nama_sekolah') !== -1)) {
            return;
          }
        }

        if (isSoal) {
          if (!String(cols[5] || '').trim()) {
            return;
          }
          records.push(parseImportedSoalRow(cols, targetPaketId, records.length + 1));
        } else if (isUsers) {
          const uname = String(cols[0] || '').trim();
          const nama = String(cols[1] || '').trim();
          if (!uname || !nama) {
            return;
          }
          records.push({
            username: uname,
            nama_lengkap: nama,
            kelas: String(cols[2] || '').trim(),
            password: String(cols[3] || uname).trim(),
            role: 'siswa',
            sekolah_id: String(cols[4] || state.user.sekolah_id || '').trim(),
            status: 'AKTIF'
          });
        } else {
          const sName = String(cols[1] || '').trim();
          if (!sName) {
            return;
          }
          records.push({
            sekolah_id: String(cols[0] || '').trim(),
            nama_sekolah: sName,
            kecamatan: String(cols[2] || '').trim(),
            jenjang: String(cols[3] || 'SD').trim(),
            status_aktif: 'AKTIF'
          });
        }
      });

      if (records.length === 0) {
        showToast('Tidak ditemukan baris data valid untuk diimpor.', 'warning');
        return;
      }

      closeModal();
      showLoader('Mengimpor ' + records.length + ' baris data...');
      try {
        const res = await EduApi.saveEntityRecord(entity, 'batch_create', { records: records });
        if (entity === 'Sekolah') {
          EduApi.invalidateMasterConfigCache();
        }
        showToast(res.inserted + ' data berhasil diimpor.', 'success');
        const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
        const activeMenu = menus.find(function (m) {
          return m.key === state.portalTab;
        });
        if (activeMenu) {
          await loadCrudModule(activeMenu);
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        hideLoader();
      }
    });

    $('batch-excel-file').addEventListener('change', function (ev) {
      const file = ev.target.files && ev.target.files[0];
      if (!file) {
        parsedFileMatrix = null;
        $('batch-file-status').textContent = '';
        return;
      }
      if (typeof XLSX === 'undefined') {
        showToast('Library pembaca Excel belum termuat. Segarkan halaman dan coba lagi.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const preferredSheet = isSoal ? 'Template_Bank_Soal' : isUsers ? 'Template_Data_Siswa' : wb.SheetNames[0];
          const sheetName = wb.SheetNames.indexOf(preferredSheet) !== -1 ? preferredSheet : wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
          parsedFileMatrix = rows.filter(function (r) {
            return Array.isArray(r) && r.some(function (cell) {
              return String(cell || '').trim() !== '';
            });
          });
          $('batch-file-status').textContent = 'Sheet "' + sheetName + '" siap diproses (' + Math.max(0, parsedFileMatrix.length - 1) + ' baris data terbaca).';
        } catch (err) {
          parsedFileMatrix = null;
          showToast('Gagal membaca file Excel: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function openCopyQuestionsModal() {
    if (!state.paketList || state.paketList.length < 2) {
      showToast('Diperlukan minimal 2 Paket Ujian untuk menyalin soal antar-paket.', 'warning');
      return;
    }

    const activeFilterPaket = $('crud-filter').value || '';
    const defaultTarget = activeFilterPaket || state.paketList[1].paket_id;
    const defaultSource = state.paketList.find(function (p) {
      return String(p.paket_id) !== String(defaultTarget);
    }) || state.paketList[0];

    const buildPaketOpts = function (selectedId) {
      return state.paketList
        .map(function (p) {
          const sel = String(p.paket_id) === String(selectedId) ? ' selected' : '';
          return '<option value="' + EduDashboard.escapeHtml(p.paket_id) + '"' + sel + '>' + EduDashboard.escapeHtml(p.nama_ujian) + '</option>';
        })
        .join('');
    };

    const html =
      '<div class="form-grid">' +
        '<div class="form-group"><label>Paket Sumber (Asal Soal)</label><select id="copy-source-paket" class="form-control">' + buildPaketOpts(defaultSource.paket_id) + '</select></div>' +
        '<div class="form-group"><label>Paket Tujuan (Hasil Salinan)</label><select id="copy-target-paket" class="form-control">' + buildPaketOpts(defaultTarget) + '</select></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8faff;border:1px solid #bfdbfe;border-radius:10px;">' +
        '<label class="checkbox-label"><input type="checkbox" id="copy-select-all" checked /><span>Pilih / Batal Pilih Semua Butir</span></label>' +
        '<span id="copy-selected-counter" style="font-size:0.82rem;font-weight:700;color:#1d63ff;">0 soal dipilih</span>' +
      '</div>' +
      '<div id="copy-source-questions-box" style="max-height:290px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;"></div>';

    openModal('Salin / Gabung Soal Antar-Paket', html, 'Salin Soal Terpilih', async function () {
      const sourceId = $('copy-source-paket').value;
      const targetId = $('copy-target-paket').value;
      if (String(sourceId) === String(targetId)) {
        showToast('Paket sumber dan paket tujuan tidak boleh sama.', 'warning');
        return;
      }

      const checkedIds = [];
      document.querySelectorAll('.copy-soal-chk:checked').forEach(function (chk) {
        checkedIds.push(chk.value);
      });

      if (checkedIds.length === 0) {
        showToast('Centang minimal 1 butir soal untuk disalin.', 'warning');
        return;
      }

      const existingTargetSoal = state.crudRecords.filter(function (s) {
        return String(s.paket_id) === String(targetId);
      });
      let nextNoUrut = existingTargetSoal.reduce(function (maxNo, item) {
        const n = Number(item.no_urut) || 0;
        return n > maxNo ? n : maxNo;
      }, 0) + 1;

      const clonedRecords = state.crudRecords
        .filter(function (s) {
          return String(s.paket_id) === String(sourceId) && checkedIds.indexOf(String(s.soal_id)) !== -1;
        })
        .sort(function (a, b) {
          return (Number(a.no_urut) || 0) - (Number(b.no_urut) || 0);
        })
        .map(function (s) {
          const item = {
            paket_id: targetId,
            no_urut: nextNoUrut++,
            tipe_soal_kode: s.tipe_soal_kode,
            lingkup_materi_kode: s.lingkup_materi_kode || '',
            stimulus_teks: s.stimulus_teks || '',
            stimulus_gambar_url: s.stimulus_gambar_url || '',
            pertanyaan: s.pertanyaan || '',
            opsi_json: s.opsi_json || '[]',
            kunci_json: s.kunci_json || '{}',
            bobot: Number(s.bobot) || 1
          };
          return item;
        });

      closeModal();
      showLoader('Menyalin ' + clonedRecords.length + ' butir soal...');
      try {
        const res = await EduApi.saveEntityRecord('Bank_Soal', 'batch_create', { records: clonedRecords });
        showToast(res.inserted + ' soal berhasil disalin ke paket tujuan.', 'success');
        const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
        const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
        if (activeMenu) {
          await loadCrudModule(activeMenu);
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        hideLoader();
      }
    });

    const updateCounter = function () {
      const count = document.querySelectorAll('.copy-soal-chk:checked').length;
      $('copy-selected-counter').textContent = count + ' soal dipilih';
    };

    const renderSourceQuestions = function () {
      const sourceId = $('copy-source-paket').value;
      const list = state.crudRecords
        .filter(function (s) { return String(s.paket_id) === String(sourceId); })
        .sort(function (a, b) { return (Number(a.no_urut) || 0) - (Number(b.no_urut) || 0); });

      const box = $('copy-source-questions-box');
      if (list.length === 0) {
        box.innerHTML = '<div style="text-align:center;padding:18px;color:#64748b;font-size:0.86rem;">Paket sumber ini belum memiliki butir soal.</div>';
        updateCounter();
        return;
      }

      box.innerHTML = list
        .map(function (s) {
          const shortQ = String(s.pertanyaan || '').slice(0, 95);
          return (
            '<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:#ffffff;">' +
              '<input type="checkbox" class="copy-soal-chk" value="' + EduDashboard.escapeHtml(s.soal_id) + '" checked style="margin-top:3px;" />' +
              '<div style="font-size:0.85rem;">' +
                '<strong>No. ' + EduDashboard.escapeHtml(s.no_urut) + '</strong> <span class="badge-soft-purple">' + EduDashboard.escapeHtml(s.tipe_soal_kode) + '</span> ' +
                '<div style="color:#334155;margin-top:2px;">' + EduDashboard.escapeHtml(shortQ) + '</div>' +
              '</div>' +
            '</label>'
          );
        })
        .join('');

      box.querySelectorAll('.copy-soal-chk').forEach(function (chk) {
        chk.addEventListener('change', updateCounter);
      });
      $('copy-select-all').checked = true;
      updateCounter();
    };

    $('copy-source-paket').addEventListener('change', renderSourceQuestions);
    $('copy-select-all').addEventListener('change', function () {
      const checked = $('copy-select-all').checked;
      document.querySelectorAll('.copy-soal-chk').forEach(function (chk) {
        chk.checked = checked;
      });
      updateCounter();
    });

    renderSourceQuestions();
  }

  async function openStudentPreviewModal(paketId) {
    if (!paketId) {
      showToast('Pilih paket ujian terlebih dahulu untuk pratinjau.', 'warning');
      return;
    }

    let allSoal = state.portalTab === 'soal' ? state.crudRecords : [];
    if (allSoal.length === 0) {
      showLoader('Memuat butir soal pratinjau...');
      try {
        const res = await EduApi.getEntityData('Bank_Soal');
        allSoal = res.records || [];
      } catch (err) {
        hideLoader();
        showToast(err.message, 'error');
        return;
      }
      hideLoader();
    }

    const paketSoal = allSoal
      .filter(function (s) { return String(s.paket_id) === String(paketId); })
      .sort(function (a, b) { return (Number(a.no_urut) || 0) - (Number(b.no_urut) || 0); });

    if (paketSoal.length === 0) {
      showToast('Paket ujian ini belum memiliki butir soal untuk dipratinjau.', 'warning');
      return;
    }

    const paketObj = state.paketList.find(function (p) { return String(p.paket_id) === String(paketId); }) || {};
    let previewIdx = 0;

    const html =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">' +
        '<div><strong>Mode Pratinjau Layar Siswa</strong> • ' + EduDashboard.escapeHtml(paketObj.nama_ujian || paketId) + '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
          '<button type="button" id="btn-prev-preview" class="btn-outline-sm">‹ Sebelumnya</button>' +
          '<span id="preview-pos-label" style="font-size:0.84rem;font-weight:700;padding:0 6px;">1 / ' + paketSoal.length + '</span>' +
          '<button type="button" id="btn-next-preview" class="btn-outline-sm">Berikutnya ›</button>' +
        '</div>' +
      '</div>' +
      '<div id="preview-stage-card" class="exam-question-card" style="box-shadow:none;border:1px solid #e2e8f0;min-height:300px;"></div>';

    openModal('Pratinjau Tampilan Soal Siswa', html, 'Tutup Pratinjau', closeModal, true);
    const dialog = document.querySelector('#global-modal .modal-dialog');
    if (dialog) {
      dialog.classList.add('modal-wide');
    }

    const renderPreviewStage = function () {
      const s = paketSoal[previewIdx];
      const tipe = String(s.tipe_soal_kode || 'PG').toUpperCase();
      let opsiParsed = [];
      try {
        opsiParsed = s.opsi_json ? JSON.parse(s.opsi_json) : [];
      } catch (e) {
        opsiParsed = [];
      }

      $('preview-pos-label').textContent = (previewIdx + 1) + ' / ' + paketSoal.length;
      $('btn-prev-preview').disabled = previewIdx === 0;
      $('btn-next-preview').disabled = previewIdx === paketSoal.length - 1;

      const stimHtml = (s.stimulus_teks || s.stimulus_gambar_url)
        ? '<div class="question-stimulus">' +
            (s.stimulus_teks ? '<div class="stimulus-passage">' + EduDashboard.escapeHtml(s.stimulus_teks) + '</div>' : '') +
            (s.stimulus_gambar_url ? '<figure class="stimulus-figure"><img src="' + EduDashboard.escapeHtml(normalizeDriveImageUrl(s.stimulus_gambar_url)) + '" alt="Ilustrasi Soal" /></figure>' : '') +
          '</div>'
        : '';

      let optsHtml = '';
      if (tipe === 'PG' || tipe === 'SURVEI') {
        optsHtml = (Array.isArray(opsiParsed) ? opsiParsed : [])
          .map(function (o, i) {
            const badge = tipe === 'SURVEI' ? String(i + 1) : String(o.id);
            return (
              '<div class="option-item">' +
                '<span class="option-key-badge">' + EduDashboard.escapeHtml(badge) + '</span>' +
                '<span class="option-label-text">' + EduDashboard.escapeHtml(o.teks) + '</span>' +
              '</div>'
            );
          })
          .join('');
      } else if (tipe === 'PGK_MCMA') {
        optsHtml = (Array.isArray(opsiParsed) ? opsiParsed : [])
          .map(function (o) {
            return (
              '<div class="option-item checkbox-mode">' +
                '<span class="option-key-badge"></span>' +
                '<span class="option-label-text">' + EduDashboard.escapeHtml(o.teks) + '</span>' +
              '</div>'
            );
          })
          .join('');
      } else if (tipe === 'PGK_BS') {
        const cols = opsiParsed && Array.isArray(opsiParsed.kolom) ? opsiParsed.kolom : ['Benar', 'Salah'];
        const rows = opsiParsed && Array.isArray(opsiParsed.baris) ? opsiParsed.baris : [];
        optsHtml =
          '<table class="pgk-bs-table"><thead><tr><th>Pernyataan</th>' +
          cols.map(function (c) { return '<th class="center">' + EduDashboard.escapeHtml(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + EduDashboard.escapeHtml(r.teks) + '</td>' +
              cols.map(function () { return '<td class="center"><input type="radio" class="pgk-radio" disabled /></td>'; }).join('') +
              '</tr>';
          }).join('') +
          '</tbody></table>';
      }

      $('preview-stage-card').innerHTML =
        '<div class="question-meta-bar">' +
          '<div class="question-badges">' +
            '<span class="badge-solid-blue">Soal No. ' + (previewIdx + 1) + '</span>' +
            '<span class="badge-soft-purple">' + EduDashboard.escapeHtml(getQuestionTypeLabel(tipe)) + '</span>' +
            (s.lingkup_materi_kode ? '<span class="badge-soft-slate">' + EduDashboard.escapeHtml(resolveConfigLabel(s.lingkup_materi_kode)) + '</span>' : '') +
          '</div>' +
        '</div>' +
        stimHtml +
        '<div class="question-stem">' + EduDashboard.escapeHtml(s.pertanyaan || '') + '</div>' +
        '<div class="options-wrapper">' + optsHtml + '</div>';
    };

    $('btn-prev-preview').addEventListener('click', function () {
      if (previewIdx > 0) {
        previewIdx--;
        renderPreviewStage();
      }
    });

    $('btn-next-preview').addEventListener('click', function () {
      if (previewIdx < paketSoal.length - 1) {
        previewIdx++;
        renderPreviewStage();
      }
    });

    renderPreviewStage();
  }

  async function submitCrudSave(entity, operation, record) {
    closeModal();
    showLoader('Menyimpan data ke Google Sheets...');
    try {
      await EduApi.saveEntityRecord(entity, operation, { record: record });
      if (entity === 'Master_Konfigurasi' || entity === 'Sekolah') {
        EduApi.invalidateMasterConfigCache();
      }
      showToast('Data berhasil disimpan.', 'success');
      const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
      const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
      if (activeMenu) {
        await loadCrudModule(activeMenu);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      hideLoader();
    }
  }

  /* ================= EVENT BINDINGS ================= */
  function bindEvents() {
    $('btn-toggle-setup-password').addEventListener('click', function () {
      const inp = $('setup-password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    $('btn-toggle-password').addEventListener('click', function () {
      const inp = $('login-password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    $('link-forgot-password').addEventListener('click', function () {
      openModal(
        'Bantuan Kata Sandi',
        '<p>Untuk keamanan akun peserta didik dan guru, pengaturan ulang kata sandi dilakukan melalui <strong>Guru Kelas</strong> atau <strong>Admin Kecamatan</strong> pada menu Manajemen Pengguna.</p>',
        'Mengerti',
        closeModal,
        true
      );
    });

    $('setup-admin-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      showLoader('Membuat akun Admin utama...');
      try {
        const res = await EduApi.setupFirstAdmin({
          nama_lengkap: $('setup-nama').value.trim(),
          username: $('setup-username').value.trim(),
          password: $('setup-password').value
        });
        EduApi.saveSession(res.token, res.user, true);
        state.user = res.user;
        showToast('Akun Admin utama berhasil dibuat!', 'success');
        await routeAuthenticatedUser();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        hideLoader();
      }
    });

    $('login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const alertBox = $('login-alert');
      alertBox.classList.add('hidden');
      showLoader('Memverifikasi kredensial...');
      try {
        const identifier = $('login-identifier').value.trim();
        const password = $('login-password').value;
        const remember = $('login-remember').checked;
        const res = await EduApi.login(identifier, password);
        EduApi.saveSession(res.token, res.user, remember);
        state.user = res.user;
        await routeAuthenticatedUser();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
      } finally {
        hideLoader();
      }
    });

    document.querySelectorAll('.font-size-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyExamFontScale(btn.getAttribute('data-font-scale'));
      });
    });

    $('btn-fullscreen').addEventListener('click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else {
        document.exitFullscreen().catch(function () {});
      }
    });

    $('btn-refresh-exams').addEventListener('click', async function () {
      showLoader('Menyegarkan jadwal...');
      try {
        await loadExamLobby();
      } finally {
        hideLoader();
      }
    });

    $('btn-force-sync').addEventListener('click', async function () {
      if (!state.activeExam) {
        return;
      }
      const ok = await EduApi.ExamStorage.flushOutboxNow(
        state.user.user_id,
        state.activeExam.jadwal_id,
        updateSyncIndicator
      );
      if (ok) {
        showToast('Jawaban berhasil dicadangkan ke server.', 'success');
      } else {
        showToast('Sedang mengantre atau menunggu perubahan baru, data tetap aman di laptop.', 'info');
      }
    });

    $('chk-doubtful').addEventListener('change', function () {
      if (!state.activeExam) {
        return;
      }
      const soal = state.activeExam.soal[state.currentQuestionIndex];
      if (soal) {
        state.doubtfulMap[soal.soal_id] = $('chk-doubtful').checked;
        persistLocalExamDraft();
        renderNavGrid();
      }
    });

    $('btn-prev-question').addEventListener('click', function () {
      if (state.currentQuestionIndex > 0) {
        state.currentQuestionIndex--;
        renderCurrentQuestion();
        renderNavGrid();
      }
    });

    $('btn-next-question').addEventListener('click', function () {
      if (state.activeExam && state.currentQuestionIndex < state.activeExam.soal.length - 1) {
        navigateToQuestionIndex(state.currentQuestionIndex + 1);
      }
    });

    $('btn-finish-exam').addEventListener('click', function () {
      if (!state.activeExam) {
        return;
      }
      const total = state.activeExam.soal.length;
      const answered = state.activeExam.soal.filter(function (s) { return isQuestionAnswered(s.soal_id); }).length;
      const unanswered = total - answered;

      openModal(
        'Konfirmasi Selesai Ujian',
        '<p>Anda telah menjawab <strong>' + answered + ' dari ' + total + '</strong> soal.' +
        (unanswered > 0 ? ' Masih terdapat <strong>' + unanswered + ' soal</strong> yang belum dijawab.' : '') +
        '</p><p style="margin-top:8px;color:#475569;">Setelah dikirim, jawaban tidak dapat diubah kembali. Lanjutkan?</p>',
        'Ya, Kirim Jawaban',
        function () {
          closeModal();
          executeFinalSubmit(false);
        }
      );
    });

    const handleLogout = function () {
      stopExamCountdown();
      EduApi.ExamStorage.stopHybridCheckpoint();
      EduApi.clearSession();
      state.user = null;
      state.activeExam = null;
      switchMainView('login');
    };

    $('btn-exam-logout').addEventListener('click', handleLogout);
    $('btn-portal-logout').addEventListener('click', handleLogout);

    $('btn-sidebar-toggle').addEventListener('click', function () {
      $('portal-sidebar').classList.toggle('open');
    });

    $('btn-portal-refresh').addEventListener('click', function () {
      navigatePortalTab(state.portalTab);
    });

    $('crud-search').addEventListener('input', applyCrudFilters);
    $('crud-filter').addEventListener('change', applyCrudFilters);

    $('btn-crud-add').addEventListener('click', function () {
      const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
      const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
      if (activeMenu && activeMenu.entity) {
        openEntityFormModal(activeMenu.entity, null);
      }
    });

    $('btn-crud-import').addEventListener('click', function () {
      const menus = getPortalMenus(String(state.user.role || '').toLowerCase());
      const activeMenu = menus.find(function (m) { return m.key === state.portalTab; });
      if (activeMenu && activeMenu.entity) {
        openBatchImportModal(activeMenu.entity);
      }
    });

    $('btn-crud-print').addEventListener('click', function () {
      window.print();
    });

    $('btn-crud-analysis-excel').addEventListener('click', function () {
      EduReport.openClassAnalysisAndExcelModal(
        state.paketList,
        state.sekolahList,
        state.user,
        {
          openModal: openModal,
          closeModal: closeModal,
          showToast: showToast
        }
      );
    });

    $('btn-crud-answer-key').addEventListener('click', function () {
      EduReport.openPrintableAnswerKeyModal(
        state.paketList,
        {
          openModal: openModal,
          closeModal: closeModal,
          showLoader: showLoader,
          hideLoader: hideLoader,
          showToast: showToast
        }
      );
    });

    $('btn-crud-cards').addEventListener('click', function () {
      EduReport.openBulkCardModal(
        state.crudRecords,
        state.sekolahList,
        state.user,
        resolveSekolahName,
        {
          openModal: openModal,
          closeModal: closeModal,
          showToast: showToast
        }
      );
    });

    $('btn-crud-copy-soal').addEventListener('click', function () {
      openCopyQuestionsModal();
    });

    $('btn-crud-preview-soal').addEventListener('click', function () {
      const selectedPaket = $('crud-filter').value || (state.paketList[0] && state.paketList[0].paket_id);
      openStudentPreviewModal(selectedPaket);
    });

    $('btn-crud-gemini').addEventListener('click', function () {
      EduReport.openGeminiConfigModal({
        openModal: openModal,
        closeModal: closeModal,
        showLoader: showLoader,
        hideLoader: hideLoader,
        showToast: showToast
      });
    });

    $('btn-modal-close').addEventListener('click', closeModal);
    $('btn-modal-cancel').addEventListener('click', closeModal);
    $('btn-modal-save').addEventListener('click', function () {
      if (typeof state.modalSaveHandler === 'function') {
        state.modalSaveHandler();
      }
    });
  }

  return {
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  EduApp.init();
});
