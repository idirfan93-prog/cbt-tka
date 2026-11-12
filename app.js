const EduApp = (function () {
  const state = {
    selectedRoleHint: 'siswa',
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

  function openModal(title, bodyHtml, saveText, onSave, hideSave) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
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

  async function loadExamLobby() {
    $('exam-lobby').classList.remove('hidden');
    $('exam-workspace').classList.add('hidden');
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

      renderNavGrid();
      renderCurrentQuestion();
      startExamCountdown();

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
        state.currentQuestionIndex = Number(btn.getAttribute('data-q-idx')) || 0;
        renderCurrentQuestion();
        renderNavGrid();
      });
    });
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
        stimImg.src = soal.stimulus_gambar_url;
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
      container.innerHTML = opsiList
        .map(function (opt, i) {
          const optId = String(opt.id);
          const isSelected = String(currentAns) === optId;
          const badgeChar = tipe === 'SURVEI' ? String(i + 1) : optId;
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

      const isSurvey = String(result.mode_penilaian || '').toUpperCase() === 'SURVEI';
      const summaryHtml =
        '<div style="text-align:center;padding:12px 0;">' +
          '<p style="font-size:0.95rem;color:#475569;margin-bottom:10px;">Asesmen <strong>' + EduDashboard.escapeHtml(namaUjian) + '</strong> telah tercatat di server.</p>' +
          (isSurvey
            ? '<div class="status-badge aktif" style="font-size:0.95rem;padding:8px 18px;">Respons Survei Berhasil Direkam</div>'
            : '<div style="font-size:2.4rem;font-weight:800;color:#1d63ff;">' + EduDashboard.escapeHtml(result.skor_akhir) + '</div><small style="color:#64748b;">Skor Akhir Anda</small>') +
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
        { key: 'hasil', label: 'Hasil dan Rekap', icon: 'bar-chart-2', entity: 'Hasil_Ujian' },
        { key: 'laporan', label: 'Cetak Laporan', icon: 'printer', entity: 'Hasil_Ujian', printMode: true }
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
      { key: 'hasil', label: 'Hasil & Rekap', icon: 'bar-chart-2', entity: 'Hasil_Ujian' },
      { key: 'laporan', label: 'Laporan & Cetak', icon: 'printer', entity: 'Hasil_Ujian', printMode: true }
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
      const filterSel = $('crud-filter');

      addBtn.classList.add('hidden');
      importBtn.classList.add('hidden');
      printBtn.classList.add('hidden');
      filterSel.classList.add('hidden');

      if (menuObj.entity !== 'Hasil_Ujian') {
        addBtn.classList.remove('hidden');
      }
      if (menuObj.entity === 'Users' || menuObj.entity === 'Sekolah') {
        importBtn.classList.remove('hidden');
      }
      if (menuObj.printMode || menuObj.entity === 'Hasil_Ujian') {
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
        '<option value="LINGKUP_MATERI">Lingkup Materi / Dimensi</option>' +
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
        { key: 'user_id', label: 'ID Peserta' },
        { key: 'sekolah_id', label: 'Sekolah', format: resolveSekolahName },
        { key: 'status_pengerjaan', label: 'Status', isStatus: true },
        { key: 'skor_akhir', label: 'Skor Akhir' },
        { key: 'waktu_submit', label: 'Waktu Kirim', format: EduDashboard.formatWaktuSingkat }
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

        const actionButtons = entity === 'Hasil_Ujian'
          ? '<button type="button" class="btn-danger-sm" data-del-id="' + recId + '">Reset</button>'
          : '<button type="button" class="btn-edit-sm" data-edit-id="' + recId + '">Edit</button> ' +
            '<button type="button" class="btn-danger-sm" data-del-id="' + recId + '">Hapus</button>';

        return '<tr>' + cells + '<td class="no-print" style="white-space:nowrap;">' + actionButtons + '</td></tr>';
      })
      .join('');

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
            '<option value="LINGKUP_MATERI"' + (rec.tipe_config === 'LINGKUP_MATERI' ? ' selected' : '') + '>Lingkup Materi / Dimensi</option>' +
            '<option value="TIPE_SOAL"' + (rec.tipe_config === 'TIPE_SOAL' ? ' selected' : '') + '>Bentuk / Tipe Soal</option>' +
          '</select></div>' +
          '<div class="form-group"><label>Kode Unik (Huruf Kapital)</label><input id="f-kode" class="form-control" value="' + EduDashboard.escapeHtml(rec.kode || '') + '" placeholder="Misal: TKA_SD / BIN / PGK_BS" /></div>' +
          '<div class="form-group full"><label>Label Tampilan</label><input id="f-label" class="form-control" value="' + EduDashboard.escapeHtml(rec.label || '') + '" placeholder="Misal: Bahasa Indonesia / Survei Karakter" /></div>' +
          '<div class="form-group"><label>Kode Induk (Opsional)</label><input id="f-parent_kode" class="form-control" value="' + EduDashboard.escapeHtml(rec.parent_kode || '') + '" placeholder="Misal: BIN (untuk lingkup materi)" /></div>' +
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
            '<option value="AKADEMIK"' + (rec.mode_penilaian !== 'SURVEI' ? ' selected' : '') + '>Skor Akademik (0 - 100)</option>' +
            '<option value="SURVEI"' + (rec.mode_penilaian === 'SURVEI' ? ' selected' : '') + '>Profil / Skala Survei (Karakter / Sulingjar)</option>' +
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

    const materiOpts = '<option value="">-- Umum / Tanpa Lingkup --</option>' + getConfigByType('LINGKUP_MATERI')
      .map(function (m) {
        return '<option value="' + EduDashboard.escapeHtml(m.kode) + '"' + (rec.lingkup_materi_kode === m.kode ? ' selected' : '') + '>' + EduDashboard.escapeHtml(m.label) + '</option>';
      })
      .join('');

    const currentTipe = rec.tipe_soal_kode || 'PG';

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
        '<div class="form-group full"><label>URL Gambar Ilustrasi Soal (Opsional)</label><input id="q-stimulus_gambar_url" class="form-control" value="' + EduDashboard.escapeHtml(rec.stimulus_gambar_url || '') + '" placeholder="https://..." /></div>' +
        '<div class="form-group full"><label>Pertanyaan</label><textarea id="q-pertanyaan" class="form-control" rows="2">' + EduDashboard.escapeHtml(rec.pertanyaan || '') + '</textarea></div>' +
        '<div id="q-dynamic-builder" class="form-group full"></div>' +
      '</div>';

    openModal(isEdit ? 'Edit Butir Soal' : 'Tambah Butir Soal', html, 'Simpan Soal', async function () {
      const built = extractQuestionBuilderData($('q-tipe_soal_kode').value, $('q-lingkup_materi_kode').value);
      const payload = {
        soal_id: rec.soal_id || '',
        paket_id: $('q-paket_id').value,
        no_urut: Number($('q-no_urut').value) || 1,
        tipe_soal_kode: $('q-tipe_soal_kode').value,
        lingkup_materi_kode: $('q-lingkup_materi_kode').value,
        stimulus_teks: $('q-stimulus_teks').value.trim(),
        stimulus_gambar_url: $('q-stimulus_gambar_url').value.trim(),
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

  function openBatchImportModal(entity) {
    const isUsers = entity === 'Users';
    const guide = isUsers
      ? 'Tempel data dari Excel/Sheets dengan format kolom dipisahkan Tab: <strong>Username/NISN [Tab] Nama Lengkap [Tab] Kelas [Tab] Password</strong>'
      : 'Tempel data dari Excel/Sheets dengan format kolom dipisahkan Tab: <strong>ID Sekolah [Tab] Nama Sekolah [Tab] Kecamatan [Tab] Jenjang</strong>';

    const html =
      '<p style="font-size:0.86rem;color:#475569;">' + guide + '</p>' +
      '<textarea id="batch-paste-area" class="form-control" rows="8" placeholder="Tempel baris data dari spreadsheet di sini..."></textarea>';

    openModal('Impor Massal ' + (isUsers ? 'Pengguna / Siswa' : 'Sekolah'), html, 'Proses Impor', async function () {
      const raw = $('batch-paste-area').value.trim();
      if (!raw) {
        showToast('Tidak ada data yang ditempel.', 'warning');
        return;
      }
      const lines = raw.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
      const records = lines.map(function (line) {
        const cols = line.split('\t');
        if (isUsers) {
          return {
            username: (cols[0] || '').trim(),
            nama_lengkap: (cols[1] || '').trim(),
            kelas: (cols[2] || '').trim(),
            password: (cols[3] || cols[0] || '123456').trim(),
            role: 'siswa',
            sekolah_id: state.user.sekolah_id || '',
            status: 'AKTIF'
          };
        }
        return {
          sekolah_id: (cols[0] || '').trim(),
          nama_sekolah: (cols[1] || '').trim(),
          kecamatan: (cols[2] || '').trim(),
          jenjang: (cols[3] || 'SD').trim(),
          status_aktif: 'AKTIF'
        };
      });

      closeModal();
      showLoader('Mengimpor ' + records.length + ' baris data...');
      try {
        const res = await EduApi.saveEntityRecord(entity, 'batch_create', { records: records });
        if (entity === 'Sekolah') {
          EduApi.invalidateMasterConfigCache();
        }
        showToast(res.inserted + ' data berhasil diimpor.', 'success');
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
    document.querySelectorAll('.role-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        document.querySelectorAll('.role-pill').forEach(function (p) { p.classList.remove('active'); });
        pill.classList.add('active');
        state.selectedRoleHint = pill.getAttribute('data-role') || 'siswa';
      });
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
        const res = await EduApi.login(identifier, password, state.selectedRoleHint);
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
      updateSyncIndicator('syncing');
      try {
        await EduApi.syncProgress(state.activeExam.jadwal_id, state.answers);
        updateSyncIndicator('synced');
        showToast('Jawaban berhasil dicadangkan ke server.', 'success');
      } catch (err) {
        updateSyncIndicator('local');
        showToast('Gagal sinkron ke server, data tetap aman di laptop.', 'warning');
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
        state.currentQuestionIndex++;
        renderCurrentQuestion();
        renderNavGrid();
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
