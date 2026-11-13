const EduDashboard = (function () {
  let activeCharts = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) {
      return '';
    }
    const entityMap = {
      '&': '&' + 'amp;',
      '<': '&' + 'lt;',
      '>': '&' + 'gt;',
      '"': '&' + 'quot;',
      "'": '&' + '#39;'
    };
    return String(str).replace(/[&<>"']/g, function (ch) {
      return entityMap[ch];
    });
  }

  function destroyCharts() {
    while (activeCharts.length > 0) {
      const chart = activeCharts.pop();
      if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
      }
    }
  }

  function formatTanggalIndo(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(d.getTime())) {
      return String(dateInput || '-');
    }
    return d.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function formatWaktuSingkat(dateInput) {
    if (!dateInput || dateInput === '-') {
      return '-';
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) {
      return String(dateInput);
    }
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getStatusClass(statusText) {
    const s = String(statusText || '').toLowerCase();
    if (s.indexOf('aktif') !== -1 && s.indexOf('non') === -1) {
      return 'aktif';
    }
    if (s.indexOf('selesai') !== -1) {
      return 'selesai';
    }
    if (s.indexOf('non') !== -1) {
      return 'nonaktif';
    }
    return 'terjadwal';
  }

  function renderKpiCards(items) {
    const grid = document.getElementById('portal-kpi-grid');
    if (!grid) {
      return;
    }
    grid.innerHTML = items
      .map(function (item) {
        return (
          '<div class="kpi-card ' + escapeHtml(item.color) + '">' +
            '<div class="kpi-icon-circle"><i data-lucide="' + escapeHtml(item.icon) + '"></i></div>' +
            '<div>' +
              '<div class="kpi-value">' + escapeHtml(item.value) + '</div>' +
              '<div class="kpi-label">' + escapeHtml(item.label) + '</div>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTeacherBeranda(data, onNavigate) {
    destroyCharts();

    const welcomeTitle = document.getElementById('welcome-title');
    const welcomeSub = document.getElementById('welcome-subtitle');
    const contextText = document.getElementById('welcome-context-text');

    if (welcomeTitle) {
      welcomeTitle.textContent = 'Selamat Datang, Bapak/Ibu Guru!';
    }
    if (welcomeSub) {
      welcomeSub.textContent = 'Kelola data siswa, jadwal pelaksanaan, hasil, dan laporan tryout/TKA dengan mudah.';
    }
    if (contextText) {
      const sekolahNama = data.sekolah && data.sekolah.nama_sekolah ? data.sekolah.nama_sekolah : 'Sekolah Terdaftar';
      const kec = data.sekolah && data.sekolah.kecamatan ? ' • ' + data.sekolah.kecamatan : '';
      contextText.textContent = sekolahNama + kec;
    }

    const kpi = data.kpi || {};
    renderKpiCards([
      { color: 'blue', icon: 'users', value: kpi.jumlah_siswa || 0, label: 'Jumlah Siswa' },
      { color: 'purple', icon: 'calendar', value: kpi.jadwal_ujian || 0, label: 'Jadwal Ujian' },
      { color: 'orange', icon: 'file-text', value: kpi.paket_ujian || 0, label: 'Paket Ujian' },
      { color: 'green', icon: 'check-circle-2', value: kpi.ujian_selesai || 0, label: 'Ujian Selesai' }
    ]);

    const container = document.getElementById('portal-widgets-container');
    if (!container) {
      return;
    }

    const jadwalRows = data.jadwal_terdekat || [];
    const jadwalTableHtml = jadwalRows.length === 0
      ? '<div class="empty-state-card compact"><p>Belum ada jadwal pelaksanaan ujian yang dibuat.</p></div>'
      : '<div class="table-responsive"><table class="data-table"><thead><tr>' +
          '<th>No</th><th>Nama Ujian</th><th>Kelas</th><th>Mata Pelajaran</th><th>Tanggal</th><th>Status</th>' +
        '</tr></thead><tbody>' +
        jadwalRows
          .map(function (row, idx) {
            return (
              '<tr>' +
                '<td>' + (idx + 1) + '</td>' +
                '<td><strong>' + escapeHtml(row.nama_ujian) + '</strong></td>' +
                '<td>' + escapeHtml(row.kelas) + '</td>' +
                '<td>' + escapeHtml(row.mata_pelajaran) + '</td>' +
                '<td>' + escapeHtml(formatWaktuSingkat(row.tanggal)) + '</td>' +
                '<td><span class="status-badge ' + getStatusClass(row.status) + '">' + escapeHtml(row.status) + '</span></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';

    const rekapRows = data.rekap_nilai || [];
    const rekapTableHtml = rekapRows.length === 0
      ? '<div class="empty-state-card compact"><p>Belum ada rekap nilai karena ujian belum selesai dikerjakan.</p></div>'
      : '<div class="table-responsive"><table class="data-table"><thead><tr>' +
          '<th>Mata Pelajaran</th><th>Peserta</th><th>Rata-rata</th><th>Tertinggi</th><th>Ketuntasan</th>' +
        '</tr></thead><tbody>' +
        rekapRows
          .map(function (row) {
            return (
              '<tr>' +
                '<td><strong>' + escapeHtml(row.mata_pelajaran) + '</strong></td>' +
                '<td>' + escapeHtml(row.peserta) + '</td>' +
                '<td>' + escapeHtml(row.rata_rata) + '</td>' +
                '<td>' + escapeHtml(row.nilai_tertinggi) + '</td>' +
                '<td><span class="status-badge aktif">' + escapeHtml(row.ketuntasan) + '%</span></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';

    const grafikData = data.grafik_perkembangan || [];
    const hasChartData = grafikData.length > 0;

    container.innerHTML =
      '<div class="widget-card col-span-8">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="calendar-clock"></i><span>Jadwal Pelaksanaan Terdekat</span></div>' +
          '<button type="button" class="text-link-btn" data-nav-target="jadwal">Lihat Semua →</button>' +
        '</div>' +
        jadwalTableHtml +
      '</div>' +
      '<div class="widget-card col-span-4">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="zap"></i><span>Menu Cepat</span></div>' +
        '</div>' +
        '<div class="quick-menu-grid">' +
          '<button type="button" class="quick-menu-btn blue" data-nav-target="users"><i data-lucide="users"></i><span>Data Siswa</span></button>' +
          '<button type="button" class="quick-menu-btn purple" data-nav-target="jadwal"><i data-lucide="calendar-clock"></i><span>Info Jadwal & Token</span></button>' +
          '<button type="button" class="quick-menu-btn green" data-nav-target="hasil"><i data-lucide="bar-chart-2"></i><span>Lihat Hasil</span></button>' +
          '<button type="button" class="quick-menu-btn orange" data-nav-target="users"><i data-lucide="id-card"></i><span>Kartu Login Siswa</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="widget-card col-span-6">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="trending-up"></i><span>Perkembangan Hasil Ujian</span></div>' +
        '</div>' +
        '<div class="chart-box">' +
          '<canvas id="chart-teacher-progress"></canvas>' +
          (hasChartData ? '' : '<div class="chart-empty-overlay">Menunggu data pelaksanaan ujian pertama untuk menampilkan grafik perkembangan.</div>') +
        '</div>' +
      '</div>' +
      '<div class="widget-card col-span-6">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="trophy"></i><span>Rekap Nilai Terbaru</span></div>' +
          '<button type="button" class="text-link-btn" data-nav-target="hasil">Lihat Rekap Lengkap →</button>' +
        '</div>' +
        rekapTableHtml +
      '</div>';

    container.querySelectorAll('[data-nav-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (onNavigate) {
          onNavigate(btn.getAttribute('data-nav-target'));
        }
      });
    });

    const ctx = document.getElementById('chart-teacher-progress');
    if (ctx && typeof Chart !== 'undefined') {
      const labels = hasChartData ? grafikData.map(function (g) { return g.label; }) : ['Tryout 1', 'Tryout 2', 'Tryout 3'];
      const values = hasChartData ? grafikData.map(function (g) { return g.rata_rata; }) : [0, 0, 0];
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Rata-rata Nilai',
            data: values,
            borderColor: '#1d63ff',
            backgroundColor: 'rgba(29, 99, 255, 0.14)',
            borderWidth: 3,
            pointBackgroundColor: '#1d63ff',
            pointRadius: 5,
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 100, grid: { color: '#eef4ff' } },
            x: { grid: { display: false } }
          }
        }
      });
      activeCharts.push(chart);
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  function renderAdminBeranda(data, onNavigate, onFilterDaysChange, currentFilterDays) {
    destroyCharts();

    const welcomeTitle = document.getElementById('welcome-title');
    const welcomeSub = document.getElementById('welcome-subtitle');
    const contextText = document.getElementById('welcome-context-text');

    if (welcomeTitle) {
      welcomeTitle.textContent = 'Selamat Datang, Admin!';
    }
    if (welcomeSub) {
      welcomeSub.textContent = 'Kelola seluruh data sekolah, pengguna, paket ujian, dan hasil pelaksanaan tes.';
    }
    if (contextText) {
      contextText.textContent = formatTanggalIndo(new Date());
    }

    const kpi = data.kpi || {};
    renderKpiCards([
      { color: 'blue', icon: 'building-2', value: kpi.sekolah_terdaftar || 0, label: 'Sekolah Terdaftar' },
      { color: 'purple', icon: 'users', value: kpi.peserta_aktif || 0, label: 'Peserta Aktif' },
      { color: 'green', icon: 'layers', value: kpi.bank_soal || 0, label: 'Bank Soal' },
      { color: 'orange', icon: 'calendar-check', value: kpi.paket_ujian || 0, label: 'Paket Ujian' }
    ]);

    const container = document.getElementById('portal-widgets-container');
    if (!container) {
      return;
    }

    const trenList = data.tren_pelaksanaan || [];
    const hasTrenData = trenList.some(function (t) { return (Number(t.count) || 0) > 0; });

    const statusObj = data.status_peserta || {
      selesai: 0,
      sedang_mengerjakan: 0,
      belum_mulai: 0,
      persentase_selesai: 0
    };
    const totalStatus = (statusObj.selesai || 0) + (statusObj.sedang_mengerjakan || 0) + (statusObj.belum_mulai || 0);

    const jadwalRows = data.jadwal_terdekat || [];
    const jadwalHtml = jadwalRows.length === 0
      ? '<div class="empty-state-card compact"><p>Belum ada jadwal pelaksanaan ujian yang diterbitkan.</p></div>'
      : '<div class="table-responsive"><table class="data-table"><thead><tr>' +
          '<th>No</th><th>Nama Ujian</th><th>Jenjang</th><th>Peserta</th><th>Jadwal</th><th>Status</th>' +
        '</tr></thead><tbody>' +
        jadwalRows
          .map(function (row, idx) {
            return (
              '<tr>' +
                '<td>' + (idx + 1) + '</td>' +
                '<td><strong>' + escapeHtml(row.nama_ujian) + '</strong></td>' +
                '<td>' + escapeHtml(row.jenjang) + '</td>' +
                '<td>' + escapeHtml(row.peserta) + '</td>' +
                '<td>' + escapeHtml(formatWaktuSingkat(row.jadwal)) + '</td>' +
                '<td><span class="status-badge ' + getStatusClass(row.status) + '">' + escapeHtml(row.status) + '</span></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';

    const distList = data.distribusi_soal || [];
    const hasDistData = distList.length > 0;

    const selectedDays = Number(currentFilterDays) || 7;

    container.innerHTML =
      '<div class="widget-card col-span-4">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="activity"></i><span>Statistik Pelaksanaan Tes</span></div>' +
          '<select id="admin-trend-filter" class="filter-select">' +
            '<option value="7"' + (selectedDays === 7 ? ' selected' : '') + '>7 Hari Terakhir</option>' +
            '<option value="14"' + (selectedDays === 14 ? ' selected' : '') + '>14 Hari Terakhir</option>' +
            '<option value="30"' + (selectedDays === 30 ? ' selected' : '') + '>30 Hari Terakhir</option>' +
          '</select>' +
        '</div>' +
        '<div class="chart-box">' +
          '<canvas id="chart-admin-trend"></canvas>' +
          (hasTrenData ? '' : '<div class="chart-empty-overlay">Belum ada aktivitas pengerjaan tes pada rentang waktu ini.</div>') +
        '</div>' +
      '</div>' +
      '<div class="widget-card col-span-4">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="pie-chart"></i><span>Status Peserta (Keseluruhan)</span></div>' +
        '</div>' +
        '<div class="chart-box">' +
          '<canvas id="chart-admin-status"></canvas>' +
          (totalStatus > 0 ? '' : '<div class="chart-empty-overlay">Belum ada peserta terdaftar di sistem.</div>') +
        '</div>' +
      '</div>' +
      '<div class="widget-card col-span-4">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="zap"></i><span>Menu Cepat</span></div>' +
        '</div>' +
        '<div class="quick-menu-grid">' +
          '<button type="button" class="quick-menu-btn blue" data-nav-target="paket"><i data-lucide="file-plus"></i><span>Buat Paket Ujian</span></button>' +
          '<button type="button" class="quick-menu-btn purple" data-nav-target="jadwal"><i data-lucide="calendar-plus"></i><span>Atur Jadwal</span></button>' +
          '<button type="button" class="quick-menu-btn green" data-nav-target="users"><i data-lucide="users"></i><span>Kelola Pengguna</span></button>' +
          '<button type="button" class="quick-menu-btn orange" data-nav-target="hasil"><i data-lucide="bar-chart-3"></i><span>Lihat Hasil</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="widget-card col-span-7">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="calendar-clock"></i><span>Pelaksanaan Ujian Terdekat</span></div>' +
          '<button type="button" class="text-link-btn" data-nav-target="jadwal">Lihat Semua →</button>' +
        '</div>' +
        jadwalHtml +
      '</div>' +
      '<div class="widget-card col-span-5">' +
        '<div class="widget-header">' +
          '<div class="widget-title"><i data-lucide="book-open"></i><span>Distribusi Soal per Mata Pelajaran</span></div>' +
        '</div>' +
        '<div class="chart-box">' +
          '<canvas id="chart-admin-distribusi"></canvas>' +
          (hasDistData ? '' : '<div class="chart-empty-overlay">Bank soal masih kosong. Tambahkan mata pelajaran & butir soal.</div>') +
        '</div>' +
      '</div>';

    container.querySelectorAll('[data-nav-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (onNavigate) {
          onNavigate(btn.getAttribute('data-nav-target'));
        }
      });
    });

    const trendSelect = document.getElementById('admin-trend-filter');
    if (trendSelect && onFilterDaysChange) {
      trendSelect.addEventListener('change', function () {
        onFilterDaysChange(Number(trendSelect.value) || 7);
      });
    }

    if (typeof Chart !== 'undefined') {
      const trendCtx = document.getElementById('chart-admin-trend');
      if (trendCtx) {
        const trendChart = new Chart(trendCtx, {
          type: 'line',
          data: {
            labels: trenList.map(function (t) { return t.label; }),
            datasets: [{
              label: 'Peserta Tes',
              data: trenList.map(function (t) { return t.count; }),
              borderColor: '#1d63ff',
              backgroundColor: 'rgba(29, 99, 255, 0.14)',
              borderWidth: 3,
              pointBackgroundColor: '#1d63ff',
              pointRadius: 4,
              fill: true,
              tension: 0.35
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef4ff' } },
              x: { grid: { display: false } }
            }
          }
        });
        activeCharts.push(trendChart);
      }

      const statusCtx = document.getElementById('chart-admin-status');
      if (statusCtx) {
        const donutData = totalStatus > 0
          ? [statusObj.selesai, statusObj.sedang_mengerjakan, statusObj.belum_mulai]
          : [1, 0, 0];
        const donutColors = totalStatus > 0
          ? ['#10b981', '#1d63ff', '#f59e0b']
          : ['#e2e8f0', '#e2e8f0', '#e2e8f0'];

        const statusChart = new Chart(statusCtx, {
          type: 'doughnut',
          data: {
            labels: [
              'Selesai (' + (statusObj.selesai || 0) + ')',
              'Sedang Mengerjakan (' + (statusObj.sedang_mengerjakan || 0) + ')',
              'Belum Mulai (' + (statusObj.belum_mulai || 0) + ')'
            ],
            datasets: [{
              data: donutData,
              backgroundColor: donutColors,
              borderWidth: 2,
              borderColor: '#ffffff'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '66%',
            plugins: {
              legend: {
                position: 'right',
                labels: { boxWidth: 12, font: { size: 11, weight: '600' } }
              }
            }
          }
        });
        activeCharts.push(statusChart);
      }

      const distCtx = document.getElementById('chart-admin-distribusi');
      if (distCtx) {
        const palette = ['#1d63ff', '#7c3aed', '#10b981', '#f59e0b', '#64748b', '#ec4899'];
        const distChart = new Chart(distCtx, {
          type: 'bar',
          data: {
            labels: hasDistData ? distList.map(function (d) { return d.label; }) : ['Belum Ada Data'],
            datasets: [{
              label: 'Jumlah Soal',
              data: hasDistData ? distList.map(function (d) { return d.jumlah; }) : [0],
              backgroundColor: distList.map(function (_, i) { return palette[i % palette.length]; }),
              borderRadius: 8,
              barThickness: 18
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef4ff' } },
              y: { grid: { display: false } }
            }
          }
        });
        activeCharts.push(distChart);
      }
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  return {
    escapeHtml: escapeHtml,
    formatWaktuSingkat: formatWaktuSingkat,
    getStatusClass: getStatusClass,
    renderTeacherBeranda: renderTeacherBeranda,
    renderAdminBeranda: renderAdminBeranda
  };
})();
