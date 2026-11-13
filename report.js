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
          'Belum ada analisis pedagogis untuk peserta didik ini. Klik tombol <strong>Analisis & Pertimbangan Pedagogis</strong> di atas untuk menyusun analisis capaian, miskonsepsi, dan pertimbangan tindak lanjut.' +
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

    const hasAcademic = report.hierarki_kompetensi.some(function (n) { return !n.is_survey; });
    const hasSurvey = report.hierarki_kompetensi.some(function (n) { return Boolean(n.is_survey); });
    const mapelTableHtml = buildCompetencyHierarchyTableHtml(report, 'academic');
    const surveiTableHtml = buildCompetencyHierarchyTableHtml(report, 'survey');

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

      '<div class="print-check-grid">' +
        '<label class="checkbox-label check-master"><input type="checkbox" id="ind-chk-lengkap" checked /><span>Lengkap (Cetak Semua Bagian Rapor)</span></label>' +
        '<label class="checkbox-label"><input type="checkbox" class="ind-chk-part" id="ind-chk-mapel"' + (hasAcademic ? ' checked' : '') + ' /><span>Tabel Mapel (Akademik)</span></label>' +
        '<label class="checkbox-label"><input type="checkbox" class="ind-chk-part" id="ind-chk-survei"' + (hasSurvey ? ' checked' : '') + ' /><span>Tabel Survei (Karakter / Sulingjar)</span></label>' +
        '<label class="checkbox-label"><input type="checkbox" class="ind-chk-part" id="ind-chk-analisis" checked /><span>Analisis & Pertimbangan Pedagogis</span></label>' +
        '<label class="checkbox-label"><input type="checkbox" class="ind-chk-part" id="ind-chk-jawaban" checked /><span>Hasil Jawaban Siswa</span></label>' +
        '<div style="grid-column:span 2;display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">' +
          '<button type="button" id="btn-run-gemini-analysis" class="btn-outline">' +
            '<i data-lucide="wand-2"></i><span>' + (report.ai_report ? 'Perbarui Analisis & Pertimbangan Pedagogis' : 'Buat Analisis & Pertimbangan Pedagogis') + '</span>' +
          '</button>' +
          '<button type="button" id="btn-print-student-selected" class="btn-primary-solid">' +
            '<i data-lucide="printer"></i><span>Cetak Rapor Sesuai Centang (A4)</span>' +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="ai-panel-box">' +
        '<div id="student-ai-analysis-content">' + renderAiCardsHtml(report.ai_report) + '</div>' +
      '</div>' +

      (hasAcademic
        ? '<div class="report-section-title"><span>Tabel Capaian Mata Pelajaran (Akademik)</span></div>' +
          '<div class="table-responsive">' + mapelTableHtml + '</div>'
        : '') +

      (hasSurvey
        ? '<div class="report-section-title"><span>Tabel Capaian Survei (Karakter / Lingkungan Belajar)</span></div>' +
          '<div class="table-responsive">' + surveiTableHtml + '</div>'
        : '') +

      '<div class="report-section-title"><span>Lembar Cek Jawaban Siswa Per Butir Soal</span></div>' +
      '<div class="table-responsive"><table class="data-table"><thead><tr>' +
        '<th>No</th><th>Tipe</th><th>Pertanyaan</th><th>Jawaban Siswa</th><th>Kunci / Acuan</th><th>Status</th>' +
      '</tr></thead><tbody>' + itemRowsHtml + '</tbody></table></div>';

    ui.openModal('Laporan Individual & Cek Jawaban Siswa', bodyHtml, 'Tutup', ui.closeModal, true);

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

    bindChecklistMasterToggle('ind-chk-lengkap', '.ind-chk-part');

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

    document.getElementById('btn-print-student-selected').addEventListener('click', function () {
      const opts = {
        includeMapel: document.getElementById('ind-chk-mapel').checked,
        includeSurvei: document.getElementById('ind-chk-survei').checked,
        includeAnalisis: document.getElementById('ind-chk-analisis').checked,
        includeJawaban: document.getElementById('ind-chk-jawaban').checked
      };
      if (!opts.includeMapel && !opts.includeSurvei && !opts.includeAnalisis && !opts.includeJawaban) {
        ui.showToast('Centang minimal 1 bagian rapor yang ingin dicetak.', 'warning');
        return;
      }
      printSingleStudentReport(report, opts);
    });
  }

  function printSingleStudentReport(report, options) {
    const opts = typeof options === 'object' && options !== null
      ? options
      : {
          includeMapel: true,
          includeSurvei: true,
          includeAnalisis: true,
          includeJawaban: Boolean(options)
        };

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

    const sectionLetters = ['A', 'B', 'C', 'D'];
    let letterIdx = 0;
    let dynamicSectionsHtml = '';

    if (opts.includeMapel) {
      const secLetter = sectionLetters[letterIdx++];
      dynamicSectionsHtml +=
        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">' + secLetter + '. Capaian Kompetensi Mata Pelajaran (' + esc(report.paket.mapel_label || 'Akademik') + ')</h4>' +
        buildCompetencyHierarchyTableHtml(report, 'academic') +
        '<div style="height:12px;"></div>';
    }

    if (opts.includeSurvei) {
      const secLetter = sectionLetters[letterIdx++];
      dynamicSectionsHtml +=
        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">' + secLetter + '. Profil Survei Karakter & Lingkungan Belajar</h4>' +
        buildCompetencyHierarchyTableHtml(report, 'survey') +
        '<div style="height:12px;"></div>';
    }

    if (opts.includeAnalisis) {
      const secLetter = sectionLetters[letterIdx++];
      dynamicSectionsHtml +=
        '<div class="print-ai-section">' +
          '<h3>' + secLetter + '. Analisis Capaian & Pertimbangan Pedagogis</h3>' +
          '<p><strong>Ringkasan Capaian:</strong> ' + esc(ai.ringkasan_capaian) + '</p>' +
          '<p><strong>Kekuatan Utama:</strong> ' + esc(ai.kekuatan_utama) + '</p>' +
          '<p><strong>Kelemahan & Miskonsepsi:</strong> ' + esc(ai.kelemahan_miskonsepsi) + '</p>' +
          '<p><strong>Pertimbangan Pedagogis:</strong> ' + esc(ai.pertimbangan_pedagogis) + '</p>' +
          '<p><strong>Rekomendasi Tindak Lanjut:</strong> ' + esc(ai.rekomendasi_tindak_lanjut) + '</p>' +
        '</div>';
    }

    if (opts.includeJawaban) {
      const secLetter = sectionLetters[letterIdx++];
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

      dynamicSectionsHtml +=
        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">' + secLetter + '. Rincian Pemeriksaan Jawaban Per Butir</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th style="width:5%;">No</th><th style="width:10%;">Tipe</th><th>Pertanyaan</th><th style="width:22%;">Jawaban Siswa</th><th style="width:20%;">Kunci</th><th style="width:10%;">Status</th>' +
        '</tr></thead><tbody>' + butirHtml + '</tbody></table>';
    }

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

        dynamicSectionsHtml +

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

  function formatPctTwoDecimals(val) {
    const num = Number(val) || 0;
    return num.toFixed(2) + '%';
  }

  function bindChecklistMasterToggle(masterId, itemSelector) {
    const masterChk = document.getElementById(masterId);
    const partChks = document.querySelectorAll(itemSelector);
    if (!masterChk) {
      return;
    }
    masterChk.addEventListener('change', function () {
      partChks.forEach(function (chk) {
        chk.checked = masterChk.checked;
      });
    });
    partChks.forEach(function (chk) {
      chk.addEventListener('change', function () {
        let allChecked = true;
        partChks.forEach(function (c) {
          if (!c.checked) {
            allChecked = false;
          }
        });
        masterChk.checked = allChecked;
      });
    });
  }

  function normalizeTreeNodesForDisplay(report, domainFilter) {
    const rawTree = Array.isArray(report.hierarki_kompetensi) ? report.hierarki_kompetensi : [];
    const filteredTree = rawTree.filter(function (node) {
      if (domainFilter === 'academic') {
        return !node.is_survey;
      }
      if (domainFilter === 'survey') {
        return Boolean(node.is_survey);
      }
      return true;
    });

    const groupedMap = {};
    const orderedKeys = [];

    filteredTree.forEach(function (node) {
      const hasExplicitChildren = (node.sub_elemen && node.sub_elemen.length > 0) || (node.indikator && node.indikator.length > 0);
      const labelStr = String(node.label || '');
      const dashIdx = labelStr.indexOf(' - ');

      if (!hasExplicitChildren && dashIdx !== -1) {
        const prefix = labelStr.slice(0, dashIdx).trim();
        const detail = labelStr.slice(dashIdx + 3).trim();
        if (!groupedMap[prefix]) {
          groupedMap[prefix] = {
            kode: prefix,
            label: prefix,
            is_survey: node.is_survey,
            poin_diperoleh: 0,
            poin_maksimal: 0,
            persentase: 0,
            sub_elemen: [],
            indikator: []
          };
          orderedKeys.push(prefix);
        }
        const parent = groupedMap[prefix];
        parent.poin_diperoleh += Number(node.poin_diperoleh) || 0;
        parent.poin_maksimal += Number(node.poin_maksimal) || 0;
        parent.indikator.push({
          kode: node.kode,
          label: detail,
          persentase: node.persentase
        });
      } else {
        const key = String(node.kode || labelStr);
        groupedMap[key] = node;
        orderedKeys.push(key);
      }
    });

    return orderedKeys.map(function (k) {
      const item = groupedMap[k];
      if (item.poin_maksimal > 0) {
        item.persentase = Math.round((item.poin_diperoleh / item.poin_maksimal) * 10000) / 100;
      }
      return item;
    });
  }

  function buildCompetencyHierarchyTableHtml(report, domainFilter) {
    const nodes = normalizeTreeNodesForDisplay(report, domainFilter);
    const headerTitle = domainFilter === 'survey'
      ? 'Dimensi & Indikator Survei (Karakter / Sulingjar)'
      : 'Elemen & Penjelasan Kompetensi Mata Pelajaran';

    if (nodes.length === 0) {
      const emptyMsg = domainFilter === 'survey'
        ? 'Tidak ada butir survei pada paket asesmen ini.'
        : 'Tidak ada butir soal mata pelajaran pada paket asesmen ini.';
      return '<table class="hierarchy-table"><thead><tr><th>' + headerTitle + '</th><th class="pct-col">Capaian</th></tr></thead>' +
        '<tbody><tr><td colspan="2" style="text-align:center;color:#64748b;">' + emptyMsg + '</td></tr></tbody></table>';
    }

    const rowsHtml = nodes.map(function (el, idx) {
      let block =
        '<tr class="tier-elemen">' +
          '<td>' + (idx + 1) + '. ' + esc(el.label) + '</td>' +
          '<td class="pct-col">' + formatPctTwoDecimals(el.persentase) + '</td>' +
        '</tr>';

      (el.sub_elemen || []).forEach(function (sub) {
        block +=
          '<tr class="tier-sub">' +
            '<td class="tier-indent-1"><span class="tier-chevron">›</span>' + esc(sub.label) + '</td>' +
            '<td class="pct-col">' + formatPctTwoDecimals(sub.persentase) + '</td>' +
          '</tr>';

        (sub.indikator || []).forEach(function (ind) {
          block +=
            '<tr class="tier-indikator">' +
              '<td class="tier-indent-2"><span class="tier-chevron">›</span>' + esc(ind.label) + '</td>' +
              '<td class="pct-col">' + formatPctTwoDecimals(ind.persentase) + '</td>' +
            '</tr>';
        });
      });

      (el.indikator || []).forEach(function (ind) {
        block +=
          '<tr class="tier-indikator">' +
            '<td class="tier-indent-1"><span class="tier-chevron">›</span>' + esc(ind.label) + '</td>' +
            '<td class="pct-col">' + formatPctTwoDecimals(ind.persentase) + '</td>' +
          '</tr>';
      });

      return block;
    }).join('');

    return (
      '<table class="hierarchy-table">' +
        '<thead><tr><th>' + headerTitle + '</th><th class="pct-col">Capaian</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>'
    );
  }

  function printClassReportPdf(analysisData) {
    const bm = analysisData.benchmark || {};
    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const diffVal = Number(bm.diff_akademik) || 0;
    const diffText = diffVal > 0 ? '+' + diffVal.toFixed(2) + ' poin di atas rata-rata wilayah'
      : diffVal < 0 ? Math.abs(diffVal).toFixed(2) + ' poin di bawah rata-rata wilayah'
      : 'Setara dengan rata-rata seluruh sekolah';

    const schoolRankRows = (bm.school_ranking || []).map(function (s, idx) {
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + esc(s.nama_sekolah) + '</td>' +
          '<td>' + esc(s.peserta) + ' siswa</td>' +
          '<td><strong>' + esc(Number(s.rata_rata).toFixed(2)) + '</strong></td>' +
        '</tr>'
      );
    }).join('');

    const studentRankRows = (analysisData.student_rows || []).map(function (st, idx) {
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + esc(st.username) + '</td>' +
          '<td>' + esc(st.nama_lengkap) + '</td>' +
          '<td>' + esc(st.kelas) + '</td>' +
          '<td><strong>' + esc(st.skor_akademik) + '</strong></td>' +
          '<td>' + (st.skor_survei !== null && st.skor_survei !== undefined ? esc(st.skor_survei) + '%' : '-') + '</td>' +
        '</tr>'
      );
    }).join('');

    const itemAnalysisRows = (analysisData.item_stats || []).map(function (it) {
      return (
        '<tr>' +
          '<td>' + esc(it.no_urut) + '</td>' +
          '<td>' + esc(it.tipe_soal_kode) + '</td>' +
          '<td>' + esc(it.pertanyaan) + '<div style="font-size:7.6pt;color:#475569;">' + esc(it.lingkup_materi_label) + '</div></td>' +
          '<td>' + esc(it.benar_penuh) + ' / ' + esc(it.jumlah_peserta) + '</td>' +
          '<td><strong>' + esc(it.tingkat_penguasaan_pct) + '%</strong></td>' +
          '<td><strong>' + esc(it.kategori_kesukaran) + '</strong></td>' +
        '</tr>'
      );
    }).join('');

    const html =
      '<div class="a4-report-sheet">' +
        '<div class="kop-header">' +
          '<h2>LAPORAN HASIL KELAS & ANALISIS BUTIR SOAL</h2>' +
          '<p>' + esc(analysisData.paket.nama_ujian) + ' • Lingkup: ' + esc(analysisData.scope_label || 'Kelas / Sekolah') + ' • Dicetak ' + esc(todayStr) + '</p>' +
        '</div>' +

        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">A. Perbandingan Rata-Rata Kelas/Sekolah Terhadap Seluruh Sekolah</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th>Rata-Rata Kelas / Sekolah</th><th>Rata-Rata Seluruh Sekolah</th><th>Selisih Capaian</th><th>Kategori Posisi</th>' +
        '</tr></thead><tbody><tr>' +
          '<td><strong>' + esc(Number(bm.class_avg_akademik || 0).toFixed(2)) + '</strong> (' + esc(bm.total_class_students || 0) + ' siswa)</td>' +
          '<td><strong>' + esc(Number(bm.all_schools_avg_akademik || 0).toFixed(2)) + '</strong> (' + esc(bm.total_all_students || 0) + ' siswa dari ' + esc(bm.total_schools_compared || 0) + ' sekolah)</td>' +
          '<td>' + esc(diffText) + '</td>' +
          '<td><strong>' + esc(bm.category || '-') + '</strong></td>' +
        '</tr></tbody></table>' +

        (schoolRankRows
          ? '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">B. Peringkat Rata-Rata Antar-Sekolah</h4>' +
            '<table class="print-data-table"><thead><tr><th style="width:8%;">Peringkat</th><th>Nama Sekolah</th><th style="width:18%;">Jumlah Peserta</th><th style="width:18%;">Rata-Rata Nilai</th></tr></thead><tbody>' + schoolRankRows + '</tbody></table>'
          : '') +

        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">C. Rekapitulasi Nilai Peserta Didik</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th style="width:6%;">No</th><th style="width:16%;">NISN</th><th>Nama Peserta Didik</th><th style="width:9%;">Kelas</th><th style="width:14%;">Skor Akademik</th><th style="width:14%;">Indeks Survei</th>' +
        '</tr></thead><tbody>' + (studentRankRows || '<tr><td colspan="6" style="text-align:center;">Belum ada peserta selesai.</td></tr>') + '</tbody></table>' +

        '<h4 style="margin-bottom:6px;font-size:10pt;color:#0b2559;">D. Analisis Tingkat Kesukaran Butir Soal</h4>' +
        '<table class="print-data-table"><thead><tr>' +
          '<th style="width:6%;">No</th><th style="width:10%;">Tipe</th><th>Butir Soal & Indikator</th><th style="width:13%;">Benar Penuh</th><th style="width:13%;">Penguasaan</th><th style="width:12%;">Kategori</th>' +
        '</tr></thead><tbody>' + (itemAnalysisRows || '<tr><td colspan="6" style="text-align:center;">Belum ada data butir soal.</td></tr>') + '</tbody></table>' +
      '</div>';

    triggerCustomPrint(html);
  }

  function printTeacherAnswerKeySheet(data) {
    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const questionsHtml = (data.soal_list || []).map(function (s) {
      const tipe = String(s.tipe_soal_kode || 'PG').toUpperCase();
      const formattedStimulus = String(s.stimulus_teks || '').replace(/\s*\|\s*/g, '\n\n');
      let optionsHtml = '';

      if (tipe === 'PG') {
        const keyId = String((s.kunci && s.kunci.jawaban) || '').toUpperCase();
        optionsHtml = '<div class="ak-options-list">' + (Array.isArray(s.opsi) ? s.opsi : []).map(function (o) {
          const isKey = String(o.id).toUpperCase() === keyId;
          return (
            '<div class="ak-option-row' + (isKey ? ' is-key' : '') + '">' +
              '<span><strong>' + esc(o.id) + '.</strong> ' + esc(o.teks) + '</span>' +
              (isKey ? '<span class="ak-key-pill">✓ Kunci Jawaban</span>' : '') +
            '</div>'
          );
        }).join('') + '</div>';
      } else if (tipe === 'PGK_MCMA') {
        const keyArr = s.kunci && Array.isArray(s.kunci.jawaban) ? s.kunci.jawaban.map(String) : [];
        optionsHtml = '<div class="ak-options-list">' + (Array.isArray(s.opsi) ? s.opsi : []).map(function (o) {
          const isKey = keyArr.indexOf(String(o.id)) !== -1;
          return (
            '<div class="ak-option-row' + (isKey ? ' is-key' : '') + '">' +
              '<span><strong>[' + esc(o.id) + ']</strong> ' + esc(o.teks) + '</span>' +
              (isKey ? '<span class="ak-key-pill">✓ Jawaban Benar</span>' : '') +
            '</div>'
          );
        }).join('') + '</div>';
      } else if (tipe === 'PGK_BS') {
        const rows = s.opsi && Array.isArray(s.opsi.baris) ? s.opsi.baris : [];
        const kMap = s.kunci && s.kunci.jawaban ? s.kunci.jawaban : {};
        optionsHtml =
          '<table class="print-data-table" style="margin-bottom:0;"><thead><tr>' +
            '<th>Pernyataan</th><th style="width:22%;">Kunci Jawaban</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + esc(r.teks) + '</td><td><strong>' + esc(kMap[r.id] || '-') + '</strong></td></tr>';
          }).join('') +
          '</tbody></table>';
      } else {
        const arah = (s.kunci && s.kunci.arah) || 'POSITIF';
        optionsHtml =
          '<div class="ak-option-row is-key">' +
            '<span>Instrumen Skala Survei Karakter / Sulingjar (Arah Pernyataan: <strong>' + esc(arah) + '</strong>)</span>' +
            '<span class="ak-key-pill">Non-Kognitif</span>' +
          '</div>';
      }

      return (
        '<div class="ak-question-card">' +
          '<div class="ak-q-header">' +
            '<span>SOAL NO. ' + esc(s.no_urut) + ' • ' + esc(tipe) + '</span>' +
            '<span>' + esc(s.lingkup_materi_label) + '</span>' +
          '</div>' +
          (formattedStimulus ? '<div class="ak-stimulus">' + esc(formattedStimulus) + '</div>' : '') +
          '<div class="ak-stem">' + esc(s.pertanyaan) + '</div>' +
          optionsHtml +
        '</div>'
      );
    }).join('');

    const html =
      '<div class="a4-report-sheet">' +
        '<div class="kop-header">' +
          '<h2>' + esc(data.sekolah_nama) + '</h2>' +
          '<p><strong>DOKUMEN KHUSUS GURU — NASKAH SOAL & KUNCI JAWABAN PEMBAHASAN</strong></p>' +
          '<p>' + esc(data.paket.nama_ujian) + ' • ' + esc(data.paket.mapel_label) + ' (Kelas ' + esc(data.paket.kelas) + ') • Dicetak ' + esc(todayStr) + '</p>' +
        '</div>' +
        questionsHtml +
      '</div>';

    triggerCustomPrint(html);
  }

  function openUnifiedPrintCenterModal(hasilRecords, paketList, sekolahList, currentUser, ui) {
    const isGuru = String(currentUser.role || '').toLowerCase() === 'guru';
    const finishedStudents = (hasilRecords || []).filter(function (r) {
      return String(r.status_pengerjaan || '').toUpperCase() === 'SELESAI';
    });

    const studentOpts = finishedStudents.length > 0
      ? finishedStudents.map(function (s) {
          return '<option value="' + esc(s.hasil_id) + '">' + esc(s.nama_siswa) + ' (' + esc(s.username_siswa) + ') — ' + esc(s.nama_paket) + '</option>';
        }).join('')
      : '<option value="">Belum ada siswa yang menyelesaikan ujian</option>';

    const pktOpts = (paketList || []).map(function (p) {
      return '<option value="' + esc(p.paket_id) + '">' + esc(p.nama_ujian) + '</option>';
    }).join('');

    const sekOpts = '<option value="">Semua Sekolah (Wilayah)</option>' + (sekolahList || []).map(function (s) {
      return '<option value="' + esc(s.sekolah_id) + '">' + esc(s.nama_sekolah) + '</option>';
    }).join('');

    const hubHtml =
      '<div class="print-hub-tabs">' +
        '<button type="button" class="print-hub-tab active" data-hub-tab="individu">1. Laporan Individu Siswa</button>' +
        '<button type="button" class="print-hub-tab" data-hub-tab="kelas">2. Laporan Kelas / Sekolah & Analisis Butir (PDF)</button>' +
        '<button type="button" class="print-hub-tab" data-hub-tab="kunci">3. Cetak Soal & Kunci Jawaban</button>' +
      '</div>' +

      '<div id="hub-pane-individu">' +
        '<div class="form-group">' +
          '<label>Pilih Peserta Didik & Paket Asesmen</label>' +
          '<select id="hub-ind-hasil" class="form-control">' + studentOpts + '</select>' +
        '</div>' +
        '<div class="print-check-grid" style="margin-top:10px;">' +
          '<label class="checkbox-label check-master"><input type="checkbox" id="hub-chk-lengkap" checked /><span>Lengkap (Cetak Semua Bagian Rapor)</span></label>' +
          '<label class="checkbox-label"><input type="checkbox" class="hub-chk-part" id="hub-chk-mapel" checked /><span>Tabel Mapel (Akademik)</span></label>' +
          '<label class="checkbox-label"><input type="checkbox" class="hub-chk-part" id="hub-chk-survei" checked /><span>Tabel Survei (Karakter / Sulingjar)</span></label>' +
          '<label class="checkbox-label"><input type="checkbox" class="hub-chk-part" id="hub-chk-analisis" checked /><span>Analisis & Pertimbangan Pedagogis</span></label>' +
          '<label class="checkbox-label"><input type="checkbox" class="hub-chk-part" id="hub-chk-jawaban" checked /><span>Hasil Jawaban Siswa</span></label>' +
        '</div>' +
        '<div style="margin-top:12px;">' +
          '<button type="button" id="btn-hub-print-individu" class="btn-primary-solid"><i data-lucide="printer"></i><span>Cetak Rapor Individu (A4 / PDF)</span></button>' +
        '</div>' +
      '</div>' +

      '<div id="hub-pane-kelas" class="hidden">' +
        '<div class="form-grid">' +
          '<div class="form-group ' + (isGuru ? 'full' : '') + '">' +
            '<label>Pilih Paket Asesmen</label>' +
            '<select id="hub-cls-paket" class="form-control">' + pktOpts + '</select>' +
          '</div>' +
          (isGuru ? '' : '<div class="form-group"><label>Lingkup Sekolah</label><select id="hub-cls-sekolah" class="form-control">' + sekOpts + '</select></div>') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
          '<button type="button" id="btn-hub-load-kelas" class="btn-outline"><i data-lucide="bar-chart-2"></i><span>Muat Analisis & Perbandingan</span></button>' +
          '<button type="button" id="btn-hub-print-kelas" class="btn-primary-solid hidden"><i data-lucide="printer"></i><span>Cetak Laporan Kelas & Analisis (PDF / A4)</span></button>' +
        '</div>' +
        '<div id="hub-kelas-preview-box" style="margin-top:12px;"></div>' +
      '</div>' +

      '<div id="hub-pane-kunci" class="hidden">' +
        '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:12px 14px;font-size:0.86rem;color:#92400e;">' +
          '<strong>Ketentuan Keamanan Asesmen:</strong> Naskah soal dan kunci jawaban hanya dapat dicetak untuk paket ujian yang jadwal pelaksanaannya telah berstatus <strong>Selesai</strong>.' +
        '</div>' +
        '<div class="form-group" style="margin-top:10px;">' +
          '<label>Pilih Paket Ujian yang Akan Dibahas di Kelas</label>' +
          '<select id="hub-ak-paket" class="form-control">' + pktOpts + '</select>' +
        '</div>' +
        '<div style="margin-top:12px;">' +
          '<button type="button" id="btn-hub-print-kunci" class="btn-primary-solid"><i data-lucide="book-open-check"></i><span>Buka & Cetak Naskah Soal + Kunci (PDF / A4)</span></button>' +
        '</div>' +
      '</div>';

    ui.openModal('Menu Pusat Cetak Laporan & Analisis', hubHtml, 'Tutup', ui.closeModal, true);
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

    document.querySelectorAll('[data-hub-tab]').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        const target = tabBtn.getAttribute('data-hub-tab');
        document.querySelectorAll('[data-hub-tab]').forEach(function (b) {
          b.classList.toggle('active', b === tabBtn);
        });
        ['individu', 'kelas', 'kunci'].forEach(function (paneKey) {
          const pane = document.getElementById('hub-pane-' + paneKey);
          if (pane) {
            pane.classList.toggle('hidden', paneKey !== target);
          }
        });
        if (target === 'kelas' && !latestClassData) {
          loadKelasAnalysis();
        }
      });
    });

    bindChecklistMasterToggle('hub-chk-lengkap', '.hub-chk-part');

    document.getElementById('btn-hub-print-individu').addEventListener('click', async function () {
      const hasilId = document.getElementById('hub-ind-hasil').value;
      if (!hasilId) {
        ui.showToast('Belum ada data siswa yang selesai mengerjakan ujian.', 'warning');
        return;
      }
      const opts = {
        includeMapel: document.getElementById('hub-chk-mapel').checked,
        includeSurvei: document.getElementById('hub-chk-survei').checked,
        includeAnalisis: document.getElementById('hub-chk-analisis').checked,
        includeJawaban: document.getElementById('hub-chk-jawaban').checked
      };
      if (!opts.includeMapel && !opts.includeSurvei && !opts.includeAnalisis && !opts.includeJawaban) {
        ui.showToast('Centang minimal 1 bagian rapor yang ingin dicetak.', 'warning');
        return;
      }
      ui.showLoader('Menyiapkan rapor individual siswa...');
      try {
        const report = await EduApi.getStudentReportDetail(hasilId);
        ui.hideLoader();
        printSingleStudentReport(report, opts);
      } catch (err) {
        ui.hideLoader();
        ui.showToast(err.message, 'error');
      }
    });

    let latestClassData = null;

    const loadKelasAnalysis = async function () {
      const paketId = document.getElementById('hub-cls-paket').value;
      if (!paketId) {
        ui.showToast('Pilih paket asesmen terlebih dahulu.', 'warning');
        return;
      }
      const sekEl = document.getElementById('hub-cls-sekolah');
      const sekolahId = isGuru ? currentUser.sekolah_id : (sekEl ? sekEl.value : '');
      const box = document.getElementById('hub-kelas-preview-box');
      const printBtn = document.getElementById('btn-hub-print-kelas');

      box.innerHTML = '<div style="padding:14px;text-align:center;color:#1d63ff;font-weight:700;">Menghitung rata-rata kelas, perbandingan seluruh sekolah, dan tingkat kesukaran butir...</div>';
      try {
        const res = await EduApi.getClassItemAnalysis(paketId, sekolahId);
        latestClassData = res;
        printBtn.classList.remove('hidden');

        const bm = res.benchmark || {};
        const catSlug = String(bm.category || 'sedang').toLowerCase();
        const catCardClass = catSlug === 'tinggi' ? 'tinggi' : catSlug === 'rendah' ? 'rendah' : 'sedang';

        const schoolRowsHtml = (bm.school_ranking || []).map(function (s, idx) {
          return (
            '<tr>' +
              '<td><strong>#' + (idx + 1) + '</strong></td>' +
              '<td>' + esc(s.nama_sekolah) + '</td>' +
              '<td>' + esc(s.peserta) + ' siswa</td>' +
              '<td><strong>' + esc(Number(s.rata_rata).toFixed(2)) + '</strong></td>' +
            '</tr>'
          );
        }).join('');

        const itemRowsHtml = (res.item_stats || []).map(function (it) {
          const badgeClass = it.kategori_kesukaran === 'Mudah' ? 'aktif' : it.kategori_kesukaran === 'Sukar' ? 'nonaktif' : 'terjadwal';
          return (
            '<tr>' +
              '<td><strong>' + esc(it.no_urut) + '</strong></td>' +
              '<td>' + esc(it.tipe_soal_kode) + '</td>' +
              '<td>' + esc(it.pertanyaan) + '<div style="font-size:0.75rem;color:#64748b;">' + esc(it.lingkup_materi_label) + '</div></td>' +
              '<td>' + esc(it.benar_penuh) + ' / ' + esc(it.jumlah_peserta) + '</td>' +
              '<td><strong>' + esc(it.tingkat_penguasaan_pct) + '%</strong></td>' +
              '<td><span class="status-badge ' + badgeClass + '">' + esc(it.kategori_kesukaran) + '</span></td>' +
            '</tr>'
          );
        }).join('');

        box.innerHTML =
          '<div class="benchmark-grid">' +
            '<div class="benchmark-card">' +
              '<div class="benchmark-val">' + esc(Number(bm.class_avg_akademik || 0).toFixed(2)) + '</div>' +
              '<div class="benchmark-lbl">Rata-Rata Kelas / Sekolah (' + esc(bm.total_class_students || 0) + ' siswa)</div>' +
            '</div>' +
            '<div class="benchmark-card">' +
              '<div class="benchmark-val">' + esc(Number(bm.all_schools_avg_akademik || 0).toFixed(2)) + '</div>' +
              '<div class="benchmark-lbl">Rata-Rata Seluruh Sekolah (' + esc(bm.total_schools_compared || 0) + ' sekolah)</div>' +
            '</div>' +
            '<div class="benchmark-card ' + catCardClass + '">' +
              '<div class="benchmark-val">' + esc(bm.category || '-') + '</div>' +
              '<div class="benchmark-lbl">Posisi Dibanding Sekolah Lain (' + (bm.diff_akademik >= 0 ? '+' : '') + esc(Number(bm.diff_akademik || 0).toFixed(2)) + ')</div>' +
            '</div>' +
          '</div>' +
          (schoolRowsHtml
            ? '<div class="report-section-title" style="margin-bottom:6px;"><span>Perbandingan Rata-Rata Antar-Sekolah</span></div>' +
              '<div class="table-responsive" style="margin-bottom:12px;"><table class="data-table"><thead><tr><th>Peringkat</th><th>Nama Sekolah</th><th>Peserta</th><th>Rata-Rata</th></tr></thead><tbody>' + schoolRowsHtml + '</tbody></table></div>'
            : '') +
          '<div class="report-section-title" style="margin-bottom:6px;"><span>Analisis Tingkat Kesukaran Butir Soal</span></div>' +
          '<div class="table-responsive"><table class="data-table"><thead><tr><th>No</th><th>Tipe</th><th>Butir Soal & Indikator</th><th>Benar Penuh</th><th>Penguasaan</th><th>Kategori</th></tr></thead><tbody>' +
          (itemRowsHtml || '<tr><td colspan="6" style="text-align:center;">Belum ada data soal.</td></tr>') +
          '</tbody></table></div>';
      } catch (err) {
        box.innerHTML = '<div class="inline-alert">' + esc(err.message) + '</div>';
      }
    };

    document.getElementById('btn-hub-load-kelas').addEventListener('click', loadKelasAnalysis);
    document.getElementById('btn-hub-print-kelas').addEventListener('click', function () {
      if (latestClassData) {
        printClassReportPdf(latestClassData);
      }
    });

    document.getElementById('btn-hub-print-kunci').addEventListener('click', async function () {
      const paketId = document.getElementById('hub-ak-paket').value;
      if (!paketId) {
        ui.showToast('Pilih paket ujian terlebih dahulu.', 'warning');
        return;
      }
      ui.showLoader('Memeriksa status ujian & menyiapkan naskah soal...');
      try {
        const res = await EduApi.getPrintableAnswerKey(paketId);
        ui.hideLoader();
        printTeacherAnswerKeySheet(res);
      } catch (err) {
        ui.hideLoader();
        ui.showToast(err.message, 'warning');
      }
    });
  }

  return {
    openGeminiConfigModal: openGeminiConfigModal,
    openStudentReportModal: openStudentReportModal,
    openBulkCardModal: openBulkCardModal,
    printAccountCards: printAccountCards,
    openUnifiedPrintCenterModal: openUnifiedPrintCenterModal
  };
})();
