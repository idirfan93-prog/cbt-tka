const EduReport = (function () {
  function esc(val) {
    return EduDashboard.escapeHtml(val);
  }

  function triggerCustomPrint(htmlContent) {
    const area = document.getElementById('print-sheet-area');
    if (!area) {
      window.print();
      return;
    }
    area.innerHTML = htmlContent;
    document.body.classList.add('printing-custom-sheet');

    const cleanup = function () {
      document.body.classList.remove('printing-custom-sheet');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    setTimeout(function () {
      window.print();
    }, 150);
  }

  function getStatusBadgeClass(statusButir) {
    const s = String(statusButir || '').toUpperCase();
    if (s === 'BENAR') {
      return 'benar';
    }
    if (s === 'SEBAGIAN') {
      return 'sebagian';
    }
    if (s === 'TERISI') {
      return 'terisi';
    }
    if (s === 'SALAH') {
      return 'salah';
    }
    return 'kosong';
  }

  function getMasteryFillClass(pct) {
    const n = Number(pct) || 0;
    if (n >= 75) {
      return 'high';
    }
    if (n >= 55) {
      return 'mid';
    }
    return 'low';
  }

  function renderAiCardsHtml(aiReport) {
    if (!aiReport) {
      return (
        '<div style="text-align:center;padding:14px 8px;color:#475569;font-size:0.86rem;">' +
          'Belum ada analisis pedagogis untuk peserta didik ini. Klik tombol <strong>Analisis dengan Gemini</strong> di atas untuk menyusun analisis capaian, miskonsepsi, dan pertimbangan tindak lanjut.' +
        '</div>'
      );
    }
    const sourceLabel = aiReport.sumber === 'GEMINI_AI' ? 'Analisis Gemini AI' : 'Analisis Pedagogis Sistem';
    return (
      '<div style="margin-bottom:8px;font-size:0.78rem;color:#4338ca;font-weight:700;">Sumber: ' + esc(sourceLabel) + '</div>' +
      '<div class="ai-grid-cards">' +
        '<div class="ai-card-item full">' +
          '<h4>1. Ringkasan Capaian Peserta Didik</h4>' +
          '<p>' + esc(aiReport.ringkasan_capaian || '-') + '</p>' +
        '</div>' +
        '<div class="ai-card-item">' +
          '<h4>2. Kekuatan Utama & Kompetensi Terkuasai</h4>' +
          '<p>' + esc(aiReport.kekuatan_utama || '-') + '</p>' +
        '</div>' +
        '<div class="ai-card-item">' +
          '<h4>3. Kelemahan & Letak Miskonsepsi</h4>' +
          '<p>' + esc(aiReport.kelemahan_miskonsepsi || '-') + '</p>' +
        '</div>' +
        '<div class="ai-card-item">' +
          '<h4>4. Pertimbangan Pedagogis</h4>' +
          '<p>' + esc(aiReport.pertimbangan_pedagogis || '-') + '</p>' +
        '</div>' +
        '<div class="ai-card-item">' +
          '<h4>5. Rekomendasi Tindak Lanjut (Guru & Orang Tua)</h4>' +
          '<p>' + esc(aiReport.rekomendasi_tindak_lanjut || '-') + '</p>' +
        '</div>' +
      '</div>'
    );
  }

  async function openGeminiConfigModal(ui) {
    ui.showLoader('Memeriksa konfigurasi Gemini AI...');
    let statusRes = { configured: false, masked: '' };
    try {
      statusRes = await EduApi.saveGeminiConfig('', 'status');
    } catch (e) {
      statusRes = { configured: false, masked: '' };
    } finally {
      ui.hideLoader();
    }

    const statusBadge = statusRes.configured
      ? '<span class="status-badge aktif">Aktif (' + esc(statusRes.masked) + ')</span>'
      : '<span class="status-badge nonaktif">Belum Diatur (Menggunakan Analisis Sistem Bawaan)</span>';

    const html =
      '<div style="background:#f8faff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;font-size:0.86rem;">' +
        '<div><strong>Status Integrasi Gemini API:</strong> ' + statusBadge + '</div>' +
        '<p style="color:#475569;margin-top:6px;">API Key disimpan terenkripsi di <em>Script Properties</em> Google Apps Script dan tidak pernah terekspos ke browser siswa maupun guru.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Masukkan Google Gemini API Key (AIzaSy...)</label>' +
        '<input type="password" id="input-gemini-api-key" class="form-control" placeholder="Tempel API Key baru atau kosongkan untuk menghapus..." />' +
      '</div>';

    ui.openModal('Pengaturan Analisis Gemini AI', html, 'Simpan API Key', async function () {
      const keyVal = document.getElementById('input-gemini-api-key').value.trim();
      ui.closeModal();
      ui.showLoader('Menyimpan konfigurasi Gemini...');
      try {
        const res = await EduApi.saveGeminiConfig(keyVal, 'save');
        ui.showToast(res.configured ? 'Gemini API Key berhasil disimpan.' : 'Gemini API Key dihapus.', 'success');
      } catch (err) {
        ui.showToast(err.message, 'error');
      } finally {
        ui.hideLoader();
      }
    });
  }

  async function openStudentReportModal(hasilId, ui) {
    ui.showLoader('Memuat laporan & lembar jawaban siswa...');
    let report = null;
    try {
      report = await EduApi.getStudentReportDetail(hasilId);
    } catch (err) {
      ui.hideLoader();
      ui.showToast(err.message, 'error');
      return;
    }
    ui.hideLoader();

    const benarCount = report.butir_jawaban.filter(function (b) { return b.status_butir === 'BENAR'; }).length;
    const totalAkd = report.hasil.total_soal_akademik || 0;
    const surveiDisplay = report.hasil.skor_survei !== null && report.hasil.skor_survei !== undefined
      ? report.hasil.skor_survei + '%'
      : '-';

    const kompRowsHtml = report.kompetensi.length === 0
      ? '<tr><td colspan="5" style="text-align:center;color:#64748b;">Belum ada pemetaan lingkup materi pada soal.</td></tr>'
      : report.kompetensi.map(function (k) {
          return (
            '<tr>' +
              '<td><strong>' + esc(k.label) + '</strong>' + (k.is_survey ? ' <span class="badge-soft-purple">Survei</span>' : '') + '</td>' +
              '<td>' + esc(k.jumlah_soal) + ' butir</td>' +
              '<td>' + esc(k.poin_diperoleh) + ' / ' + esc(k.poin_maksimal) + '</td>' +
              '<td style="min-width:120px;">' +
                '<strong>' + esc(k.persentase) + '%</strong>' +
                '<div class="mastery-bar-track"><div class="mastery-bar-fill ' + getMasteryFillClass(k.persentase) + '" style="width:' + Math.min(100, k.persentase) + '%;"></div></div>' +
              '</td>' +
              '<td><span class="status-badge ' + (k.persentase >= 70 ? 'aktif' : 'terjadwal') + '">' + esc(k.predikat) + '</span></td>' +
            '</tr>'
          );
        }).join('');

    const itemRowsHtml = report.butir_jawaban.map(function (b) {
      return (
        '<tr>' +
          '<td><strong>' + esc(b.no_urut) + '</strong></td>' +
          '<td>' + esc(b.tipe_soal_kode) + '</td>' +
          '<td>' + esc(b.pertanyaan) + '<div style="font-size:0.75rem;color:#64748b;margin-top:2px;">Materi: ' + esc(b.lingkup_materi_label) + '</div></td>' +
          '<td>' + esc(b.jawaban_siswa) + '</td>' +
          '<td>' + esc(b.kunci_jawaban) + '</td>' +
          '<td><span class="ans-badge ' + getStatusBadgeClass(b.status_butir) + '">' + esc(b.status_butir) + '</span></td>' +
        '</tr>'
      );
    }).join('');

    const bodyHtml =
      '<div class="report-identity-box">' +
        '<div class="report-identity-row"><span>Nama Peserta Didik</span><strong>' + esc(report.siswa.nama_lengkap) + '</strong></div>' +
        '<div class="report-identity-row"><span>NISN / Username</span><strong>' + esc(report.siswa.username) + '</strong></div>' +
        '<div class="report-identity-row"><span>Sekolah</span><strong>' + esc(report.sekolah.nama_sekolah) + '</strong></div>' +
        '<div class="report-identity-row"><span>Kelas</span><strong>' + esc(report.siswa.kelas) + '</strong></div>' +
        '<div class="report-identity-row"><span>Paket Asesmen</span><strong>' + esc(report.paket.nama_ujian) + '</strong></div>' +
        '<div class="report-identity-row"><span>Waktu Selesai</span><strong>' + esc(EduDashboard.formatWaktuSingkat(report.hasil.waktu_submit)) + '</strong></div>' +
      '</div>' +

      '<div class="report-score-grid">' +
        '<div class="report-score-card primary">' +
          '<div class="report-score-num">' + esc(report.hasil.skor_akademik) + '</div>' +
          '<div class="report-score-lbl">Skor Akademik (0 - 100)</div>' +
        '</div>' +
        '<div class="report-score-card survey">' +
          '<div class="report-score-num">' + esc(surveiDisplay) + '</div>' +
          '<div class="report-score-lbl">Indeks Survei Karakter / Sulingjar</div>' +
        '</div>' +
        '<div class="report-score-card summary">' +
          '<div class="report-score-num">' + esc(benarCount) + ' / ' + esc(totalAkd) + '</div>' +
          '<div class="report-score-lbl">Butir Akademik Benar Penuh</div>' +
        '</div>' +
      '</div>' +

      '<div class="ai-panel-box">' +
        '<div class="ai-panel-header">' +
          '<span class="ai-badge-pill"><i data-lucide="sparkles"></i> Analisis & Pertimbangan Pedagogis (Gemini)</span>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" id="btn-run-gemini-analysis" class="btn-primary-solid">' +
              '<i data-lucide="wand-2"></i><span>' + (report.ai_report ? 'Perbarui Analisis Gemini' : 'Analisis dengan Gemini') + '</span>' +
            '</button>' +
            '<button type="button" id="btn-print-student-report" class="btn-outline">' +
              '<i data-lucide="printer"></i><span>Cetak Laporan Siswa (A4)</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div id="student-ai-analysis-content">' + renderAiCardsHtml(report.ai_report) + '</div>' +
      '</div>' +

      '<div class="report-section-title"><span>Analisis Penguasaan Lingkup Materi & Dimensi</span></div>' +
      '<div class="table-responsive"><table class="data-table"><thead><tr>' +
        '<th>Lingkup Materi / Dimensi</th><th>Jumlah</th><th>Poin</th><th>Capaian</th><th>Predikat</th>' +
      '</tr></thead><tbody>' + kompRowsHtml + '</tbody></table></div>' +

      '<div class="report-section-title"><span>Lembar Cek Jawaban Siswa Per Butir Soal</span></div>' +
      '<div class="table-responsive"><table class="data-table"><thead><tr>' +
        '<th>No</th><th>Tipe</th><th>Pertanyaan</th><th>Jawaban Siswa</th><th>Kunci / Acuan</th><th>Status</th>' +
      '</tr></thead><tbody>' + itemRowsHtml + '</tbody></table></div>';

    ui.openModal('Laporan Komprehensif & Cek Jawaban Siswa', bodyHtml, 'Tutup', ui.closeModal, true);

    const dialog = document.querySelector('#global-modal .modal-dialog');
    if (dialog) {
      dialog.classList.add('modal-wide');
    }

    const oldClose = document.getElementById('btn-modal-close');
    const resetWideClass = function () {
      if (dialog) {
        dialog.classList.remove('modal-wide');
      }
      oldClose.removeEventListener('click', resetWideClass);
    };
    oldClose.addEventListener('click', resetWideClass);

    document.getElementById('btn-run-gemini-analysis').addEventListener('click', async function () {
      const box = document.getElementById('student-ai-analysis-content');
      box.innerHTML = '<div style="padding:14px;text-align:center;color:#1d63ff;font-weight:700;">Menyusun analisis capaian dan pertimbangan pedagogis...</div>';
      try {
        const res = await EduApi.generateGeminiStudentAnalysis(hasilId, true);
        report.ai_report = res.ai_report;
        box.innerHTML = renderAiCardsHtml(res.ai_report);
        ui.showToast('Analisis dan pertimbangan siswa berhasil diperbarui.', 'success');
      } catch (err) {
        box.innerHTML = renderAiCardsHtml(report.ai_report);
        ui.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-print-student-report').addEventListener('click', function () {
      printSingleStudentReport(report);
    });
  }

  function printSingleStudentReport(report) {
    const ai = report.ai_report || {
      ringkasan_capaian: 'Peserta didik memperoleh skor akademik ' + report.hasil.skor_akademik + '.',
      kekuatan_utama: '-',
      kelemahan_miskonsepsi: '-',
      pertimbangan_pedagogis: '-',
      rekomendasi_tindak_lanjut: '-'
    };

    const surveiText = report.hasil.skor_survei !== null && report.hasil.skor_survei !== undefined
      ? report.hasil.skor_survei + '%'
      : 'Tidak Diujikan';

    const kompHtml = report.kompetensi.map(function (k, i) {
      return (
        '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + esc(k.label) + '</td>' +
          '<td>' + esc(k.jumlah_soal) + '</td>' +
          '<td>' + esc(k.poin_diperoleh) + ' / ' + esc(k.poin_maksimal) + '</td>' +
          '<td><strong>' + esc(k.persentase) + '%</strong></td>' +
          '<td>' + esc(k.predikat) + '</td>' +
        '</tr>'
      );
    }).join('');

    const butirHtml = report.butir_jawaban.map(function (b) {
      return (
        '<tr>' +
          '<td>' + esc(b.no_urut) + '</td>' +
          '<td>' + esc(b.tipe_soal_kode) + '</td>' +
          '<td>' + esc(b.pertanyaan) + '</td>' +
          '<td>' + esc(b.jawaban_siswa) + '</td>' +
          '<td>' + esc(b.kunci_jawaban) + '</td>' +
          '<td><strong>' + esc(b.status_butir) + '</strong></td>' +
        '</tr>'
      );
    }).join('');

    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const html =
      '<div class="a4-report-sheet">' +
        '<div class="kop-header">' +
          '<h2>' + esc(report.sekolah.nama_sekolah || 'LAPORAN HASIL ASESMEN DIGITAL') + '</h2>' +
          '<p>LAPORAN INDIVIDUAL HASIL TRYOUT / TKA & ANALISIS KOMPETENSI PESERTA DIDIK</p>' +
        '</div>' +

        '<table class="print-meta-table">' +
          '<tr>' +
            '<td style="width:18%;"><strong>Nama Siswa</strong></td><td style="width:32%;">: ' + esc(report.siswa.nama_lengkap) + '</td>' +
            '<td style="width:18%;"><strong>Paket Ujian</strong></td><td style="width:32%;">: ' + esc(report.paket.nama_ujian) + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td><strong>NISN / Username</strong></td><td>: ' + esc(report.siswa.username) + '</td>' +
            '<td><strong>Skor Akademik</strong></td><td>: <strong>' + esc(report.hasil.skor_akademik) + ' / 100</strong></td>' +
          '</tr>' +
          '<tr>' +
            '<td><strong>Kelas</strong></td><td>: ' + esc(report.siswa.kelas) + '</td>' +
            '<td><strong>Indeks Survei</strong></td><td>: <strong>' + esc(surveiText) + '</strong></td>' +
          '</tr>' +
        '</table>' +

        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">A. Capaian Penguasaan Lingkup Materi & Dimensi</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th style="width:5%;">No</th><th>Lingkup Materi / Dimensi</th><th style="width:9%;">Soal</th><th style="width:13%;">Poin</th><th style="width:11%;">Capaian</th><th style="width:18%;">Predikat</th>' +
        '</tr></thead><tbody>' + kompHtml + '</tbody></table>' +

        '<div class="print-ai-section">' +
          '<h3>B. Analisis Capaian & Pertimbangan Pedagogis</h3>' +
          '<p><strong>Ringkasan Capaian:</strong> ' + esc(ai.ringkasan_capaian) + '</p>' +
          '<p><strong>Kekuatan Utama:</strong> ' + esc(ai.kekuatan_utama) + '</p>' +
          '<p><strong>Kelemahan & Miskonsepsi:</strong> ' + esc(ai.kelemahan_miskonsepsi) + '</p>' +
          '<p><strong>Pertimbangan Pedagogis:</strong> ' + esc(ai.pertimbangan_pedagogis) + '</p>' +
          '<p><strong>Rekomendasi Tindak Lanjut:</strong> ' + esc(ai.rekomendasi_tindak_lanjut) + '</p>' +
        '</div>' +

        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">C. Rincian Pemeriksaan Jawaban Per Butir</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th style="width:5%;">No</th><th style="width:10%;">Tipe</th><th>Pertanyaan</th><th style="width:22%;">Jawaban Siswa</th><th style="width:20%;">Kunci</th><th style="width:10%;">Status</th>' +
        '</tr></thead><tbody>' + butirHtml + '</tbody></table>' +

        '<div class="signature-grid">' +
          '<div class="signature-box">' +
            '<p>Mengetahui,<br/>Orang Tua / Wali Murid</p>' +
            '<div class="signature-space"></div>' +
            '<p>( ........................................ )</p>' +
          '</div>' +
          '<div class="signature-box">' +
            '<p>' + esc(report.sekolah.kecamatan || 'Wonogiri') + ', ' + esc(todayStr) + '<br/>Guru Kelas / Pengampu</p>' +
            '<div class="signature-space"></div>' +
            '<p>( ........................................ )</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    triggerCustomPrint(html);
  }

  function openBulkCardModal(records, sekolahList, currentUser, resolveSekolahName, ui) {
    const isGuru = String(currentUser.role || '').toLowerCase() === 'guru';
    const sekOpts = '<option value="">Semua Sekolah</option>' + (sekolahList || []).map(function (s) {
      return '<option value="' + esc(s.sekolah_id) + '">' + esc(s.nama_sekolah) + '</option>';
    }).join('');

    const html =
      '<p style="font-size:0.86rem;color:#475569;">Pilih kriteria pengguna untuk mencetak <strong>Kartu Login Siswa</strong> atau <strong>Kartu Pengguna Guru</strong> dalam format siap potong kertas A4.</p>' +
      '<div class="form-grid">' +
        '<div class="form-group">' +
          '<label>Jenis Kartu Akun</label>' +
          '<select id="card-filter-role" class="form-control">' +
            '<option value="siswa">Kartu Login Siswa</option>' +
            (isGuru ? '' : '<option value="guru">Kartu Pengguna Guru</option><option value="">Semua (Siswa & Guru)</option>') +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Filter Kelas (Khusus Siswa)</label>' +
          '<input type="text" id="card-filter-kelas" class="form-control" placeholder="Kosongkan untuk semua kelas..." />' +
        '</div>' +
        (isGuru ? '' : '<div class="form-group full"><label>Filter Sekolah</label><select id="card-filter-sekolah" class="form-control">' + sekOpts + '</select></div>') +
      '</div>';

    ui.openModal('Cetak Kartu Login Siswa & Kartu Guru', html, 'Cetak Kartu (A4)', function () {
      const roleVal = document.getElementById('card-filter-role').value;
      const kelasVal = document.getElementById('card-filter-kelas').value.trim().toLowerCase();
      const sekEl = document.getElementById('card-filter-sekolah');
      const sekVal = sekEl ? sekEl.value : '';

      const filtered = (records || []).filter(function (u) {
        const r = String(u.role || '').toLowerCase();
        if (r === 'admin') {
          return false;
        }
        if (roleVal && r !== roleVal) {
          return false;
        }
        if (sekVal && String(u.sekolah_id) !== String(sekVal)) {
          return false;
        }
        if (kelasVal && r === 'siswa' && String(u.kelas || '').toLowerCase() !== kelasVal) {
          return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        ui.showToast('Tidak ada data pengguna yang sesuai dengan filter cetak.', 'warning');
        return;
      }

      ui.closeModal();
      printAccountCards(filtered, resolveSekolahName);
    });
  }

  function printAccountCards(userList, resolveSekolahName) {
    const portalUrl = window.location.origin || 'https://cbt-tka.pages.dev';

    const cardsHtml = (userList || []).map(function (u) {
      const isTeacher = String(u.role || '').toLowerCase() === 'guru';
      const schoolName = resolveSekolahName ? resolveSekolahName(u.sekolah_id) : (u.sekolah_id || 'Sekolah Peserta');
      const pwdDisplay = u.password_cetak ? u.password_cetak : '(Gunakan sandi terdaftar)';

      if (isTeacher) {
        return (
          '<div class="id-card-box teacher">' +
            '<div class="id-card-header">' +
              '<strong>CBT EDUTRYOUT</strong>' +
              '<span>KARTU PENGGUNA GURU</span>' +
            '</div>' +
            '<div class="id-card-body">' +
              '<div class="id-card-school">' + esc(schoolName) + '</div>' +
              '<table class="id-card-table">' +
                '<tr><td class="lbl">Nama Guru</td><td>: <strong>' + esc(u.nama_lengkap) + '</strong></td></tr>' +
                '<tr><td class="lbl">Peran Akses</td><td>: Guru Kelas / Proktor Sekolah</td></tr>' +
                '<tr><td class="lbl">Username</td><td>: <span class="id-card-cred">' + esc(u.username) + '</span></td></tr>' +
                '<tr><td class="lbl">Kata Sandi</td><td>: <span class="id-card-cred">' + esc(pwdDisplay) + '</span></td></tr>' +
              '</table>' +
            '</div>' +
            '<div class="id-card-footer">' +
              '<span>Portal: ' + esc(portalUrl) + '</span>' +
              '<span>Jaga kerahasiaan akun</span>' +
            '</div>' +
          '</div>'
        );
      }

      return (
        '<div class="id-card-box student">' +
          '<div class="id-card-header">' +
            '<strong>CBT EDUTRYOUT</strong>' +
            '<span>KARTU LOGIN PESERTA</span>' +
          '</div>' +
          '<div class="id-card-body">' +
            '<div class="id-card-school">' + esc(schoolName) + '</div>' +
            '<table class="id-card-table">' +
              '<tr><td class="lbl">Nama Peserta</td><td>: <strong>' + esc(u.nama_lengkap) + '</strong></td></tr>' +
              '<tr><td class="lbl">Kelas</td><td>: Kelas ' + esc(u.kelas || '-') + '</td></tr>' +
              '<tr><td class="lbl">Username / NISN</td><td>: <span class="id-card-cred">' + esc(u.username) + '</span></td></tr>' +
              '<tr><td class="lbl">Kata Sandi</td><td>: <span class="id-card-cred">' + esc(pwdDisplay) + '</span></td></tr>' +
            '</table>' +
          '</div>' +
          '<div class="id-card-footer">' +
            '<span>Laman Tes: ' + esc(portalUrl) + '</span>' +
            '<span>Peserta Asesmen</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    triggerCustomPrint('<div class="cards-print-grid">' + cardsHtml + '</div>');
  }

  return {
    openGeminiConfigModal: openGeminiConfigModal,
    openStudentReportModal: openStudentReportModal,
    openBulkCardModal: openBulkCardModal,
    printAccountCards: printAccountCards
  };
})();
