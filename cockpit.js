const Cockpit = (() => {
  'use strict';

  let lastRecords = [];
  let lastContext = {};
  let lastPngBlob = null;
  let lastPngUrl = '';
  let lastPngFilename = 'cockpit-byd.png';
  let listenersAttached = false;

  const FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

  const el = (id) => document.getElementById(id);

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function todayIso() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function normalizeDate(dateValue, dateTimeValue) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(dateTimeValue || dateValue);
    if (Number.isNaN(parsed.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  function formatDateBr(isoDate) {
    const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
  }

  function formatDateShort(isoDate) {
    const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}` : isoDate;
  }

  function formatNowTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  function formatPct(value) {
    return `${Number(value || 0).toFixed(1).replace('.', ',')}%`;
  }

  function formatTime(record) {
    const raw = String(record.Hora_Ref || '').trim();
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw.slice(0, 8);
    const parsed = new Date(record.DataHora);
    if (Number.isNaN(parsed.getTime())) return '--:--:--';
    return [parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()]
      .map((n) => String(n).padStart(2, '0')).join(':');
  }

  function turnKey(value) {
    return String(value || '').replace(/^Turno\s+/i, '').trim().toUpperCase();
  }

  function shiftToChinese(shift) {
    const key = turnKey(shift);
    if (key === 'A') return 'A班 (Turno A)';
    if (key === 'B') return 'B班 (Turno B)';
    if (key === 'C') return 'C班 (Turno C)';
    return 'Geral / 全部班次';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    textarea.remove();
    return ok;
  }

  // =========================================================================
  // CONTROLES E BOTÃO DE IMAGEM DO COCKPIT
  // =========================================================================
  function ensureControls(context) {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const copyBtn = el('copyChineseReportButton');

    if (dateInput && !dateInput.value) {
      dateInput.value = todayIso();
    }

    if (shiftSelect) {
      const isLeader = String(context.profile || '').toUpperCase() === 'LIDER_TURNO';
      if (isLeader && context.shift && context.shift !== 'Geral') {
        shiftSelect.value = context.shift;
        shiftSelect.disabled = true;
      } else {
        shiftSelect.disabled = false;
      }
    }

    if (copyBtn && !el('generateCockpitImageButton')) {
      const header = copyBtn.parentElement;
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'action-row';
      header.insertBefore(actionsWrap, copyBtn);

      const imgBtn = document.createElement('button');
      imgBtn.id = 'generateCockpitImageButton';
      imgBtn.type = 'button';
      imgBtn.className = 'button button-primary';
      imgBtn.textContent = '🖼️ Gerar Imagem (PNG)';

      actionsWrap.appendChild(imgBtn);
      actionsWrap.appendChild(copyBtn);
    }

    if (!el('cockpitVisualReportCard') && el('cockpitView')) {
      const card = document.createElement('article');
      card.id = 'cockpitVisualReportCard';
      card.className = 'card';
      card.innerHTML = `
        <div class="card-header">
          <h3 class="card-title">Relatório Visual BYD (PNG para WhatsApp / WeChat)</h3>
          <div class="action-row">
            <button id="downloadCockpitPngBtn" class="button button-cyan" type="button">⬇️ Baixar PNG</button>
            <button id="shareCockpitPngBtn" class="button button-success" type="button">📲 Compartilhar Foto</button>
          </div>
        </div>
        <p class="muted-small" style="margin:6px 0 10px">
          Pré-visualização oficial sincronizada com os dados do turno selecionado.
        </p>
        <div style="border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#060A13">
          <img id="cockpitReportPreviewImg" alt="Relatório Visual Cockpit BYD" style="display:block;width:100%;height:auto">
        </div>
      `;
      const bilingualBox = el('cockpitBilingualCard');
      if (bilingualBox && bilingualBox.parentElement) {
        el('cockpitView').insertBefore(card, bilingualBox.parentElement);
      } else {
        el('cockpitView').appendChild(card);
      }
    }

    if (!listenersAttached) {
      listenersAttached = true;
      if (dateInput) dateInput.addEventListener('change', () => render());
      if (shiftSelect) shiftSelect.addEventListener('change', () => render());

      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const box = el('cockpitBilingualCard');
          if (!box || !box.textContent.trim()) return;
          const copied = await copyText(box.textContent);
          const originalLabel = copyBtn.textContent;
          copyBtn.textContent = copied ? '✓ Relatório Copiado!' : '⚠️ Falha ao copiar';
          setTimeout(() => { copyBtn.textContent = originalLabel; }, 2200);
        });
      }

      const genBtn = el('generateCockpitImageButton');
      if (genBtn) {
        genBtn.addEventListener('click', async () => {
          await renderVisualReportImage(true);
        });
      }

      const dlBtn = el('downloadCockpitPngBtn');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => downloadCurrentPng());
      }

      const shareBtn = el('shareCockpitPngBtn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => shareCurrentPng());
      }
    }
  }

  // =========================================================================
  // CÁLCULO UNIFICADO DOS DADOS (100% CONSISTENTE ENTRE CARDS, TABELA E PNG)
  // =========================================================================
  function computeMetrics(selectedDate, selectedShift) {
    const filteredRecords = lastRecords.filter((r) => {
      const sameDate = normalizeDate(r.Data_Ref, r.DataHora) === selectedDate;
      const sameShift = selectedShift === 'ALL' || turnKey(r.Turno) === turnKey(selectedShift);
      return sameDate && sameShift;
    });

    const validRecords = filteredRecords.filter((r) => String(r.Status || '').toUpperCase() !== 'ESTORNADO');
    const voidedRecords = filteredRecords.filter((r) => String(r.Status || '').toUpperCase() === 'ESTORNADO');

    const allLots = Array.isArray(lastContext.progressLots) ? lastContext.progressLots : [];
    const filteredLots = (selectedShift === 'ALL'
      ? allLots
      : allLots.filter((l) => !l.Turno_Vinculado || turnKey(l.Turno_Vinculado) === turnKey(selectedShift))
    ).map((lot) => {
      const meta = Number(lot.Total_Meta) || 0;
      const sent = Number(lot.Total_Enviado) || 0;
      const saldo = Math.max(0, meta - sent);
      const pct = meta > 0 ? Math.min(100, (sent / meta) * 100) : 0;
      const done = Boolean(lot.Concluido) || (meta > 0 && sent >= meta);
      return {
        ...lot,
        meta,
        sent,
        saldo,
        pct,
        done,
        items: Array.isArray(lot.Itens) ? lot.Itens : []
      };
    });

    const palletsDispatchedToday = validRecords.reduce((sum, r) => sum + (Number(r.Qtd_Enviada) || 0), 0);
    const voidedPallets = voidedRecords.reduce((sum, r) => sum + (Number(r.Qtd_Enviada) || 0), 0);
    const uniqueTrips = new Set(
      validRecords.map((r) => r.ID_Viagem || `${r.Data_Ref}|${r.Hora_Ref}|${r.Motorista}|${r.Frota}`)
    ).size;

    const totalLots = filteredLots.length;
    const completedLots = filteredLots.filter((l) => l.done).length;
    const pendingLots = Math.max(0, totalLots - completedLots);

    const totalProgrammed = filteredLots.reduce((sum, l) => sum + l.meta, 0);
    const totalSentLots = filteredLots.reduce((sum, l) => sum + l.sent, 0);
    const totalPendingBalance = filteredLots.reduce((sum, l) => sum + l.saldo, 0);
    const overallProgressPct = totalProgrammed > 0 ? Math.min(100, (totalSentLots / totalProgrammed) * 100) : 0;

    let palletsPerHour = 0;
    if (palletsDispatchedToday > 0) {
      const timestamps = validRecords
        .map((r) => new Date(r.DataHora).getTime())
        .filter((t) => !Number.isNaN(t));
      if (timestamps.length >= 2) {
        const spanHours = Math.max(1, (Math.max(...timestamps) - Math.min(...timestamps)) / 3600000);
        palletsPerHour = Math.round(palletsDispatchedToday / spanHours);
      } else {
        palletsPerHour = palletsDispatchedToday;
      }
    }

    return {
      selectedDate,
      selectedShift,
      filteredRecords,
      validRecords,
      voidedRecords,
      filteredLots,
      palletsDispatchedToday,
      voidedPallets,
      uniqueTrips,
      totalLots,
      completedLots,
      pendingLots,
      totalProgrammed,
      totalSentLots,
      totalPendingBalance,
      overallProgressPct,
      palletsPerHour
    };
  }

  // =========================================================================
  // GERADOR DA IMAGEM OFICIAL BYD (CANVAS 2D SEM SOBREPOSIÇÃO)
  // =========================================================================
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function truncateCanvasText(ctx, text, maxWidth) {
    const str = String(text || '');
    if (ctx.measureText(str).width <= maxWidth) return str;
    let trimmed = str;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  }

  function buildCockpitCanvas(metrics) {
    const W = 1200;
    const bannerX = 28;
    const bannerW = W - 56;

    const bannerY = 98;
    const bannerH = 44;

    const metaY = 160;
    const metaH = 88;

    const kpiStartY = 272;
    const kpiH = 132;
    const kpiGap = 16;

    const sectionTitleY = kpiStartY + kpiH * 2 + kpiGap + 34; // 586
    const tableY = sectionTitleY + 14; // 600
    const rowHeight = 64;
    const tableHeaderHeight = 48;
    const minTableRows = Math.max(1, metrics.filteredLots.length);
    const tableHeight = tableHeaderHeight + minTableRows * rowHeight + 14;

    const obsY = tableY + tableHeight + 22;
    const obsH = 212;

    const footerY = obsY + obsH + 28;
    const H = footerY + 18;
    const dpr = 2;

    const canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 1. Fundo Executivo BYD Dark Navy
    ctx.fillStyle = '#060A13';
    ctx.fillRect(0, 0, W, H);

    // 2. Cabeçalho Superior + Logo BYD Oval
    const logoCx = 74;
    const logoCy = 52;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(logoCx, logoCy, 46, 26, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#E60012';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 22px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BYD', logoCx, logoCy + 1);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 23px ${FONT_SANS}`;
    ctx.fillText('COCKPIT LOGÍSTICO - ENTREGA DE MATERIAIS', W / 2, 43);

    ctx.fillStyle = '#94A3B8';
    ctx.font = `600 15px ${FONT_SANS}`;
    ctx.fillText('物流驾驶舱 - 物料配送', W / 2, 70);

    // 3. Faixa Relatório Diário de Expedição
    const bannerGrad = ctx.createLinearGradient(bannerX, bannerY, bannerX + bannerW, bannerY);
    bannerGrad.addColorStop(0, '#78350F');
    bannerGrad.addColorStop(0.5, '#92400E');
    bannerGrad.addColorStop(1, '#78350F');
    roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 10);
    ctx.fillStyle = bannerGrad;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#D97706';
    ctx.stroke();

    ctx.fillStyle = '#FEF3C7';
    ctx.font = `800 16px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('RELATÓRIO DIÁRIO DE EXPEDIÇÃO / 每日发运报告', W / 2, bannerY + 27);

    // 4. 5 Cards Brancos de Governança
    const metaCards = [
      { label: 'DATA / 日期', value: formatDateShort(metrics.selectedDate) },
      { label: 'COORDENADOR', value: lastContext.coordinator || 'Anderson Andrade' },
      { label: 'LIDERANÇA', value: lastContext.leadership || 'Daniela Menezes' },
      { label: 'RESPONSÁVEL', value: lastContext.operator || 'Eric Miranda' },
      { label: 'TURNO / 班次', value: metrics.selectedShift === 'ALL' ? 'Geral' : metrics.selectedShift }
    ];
    const metaGap = 14;
    const metaCardW = (bannerW - metaGap * 4) / 5;

    metaCards.forEach((item, idx) => {
      const x = bannerX + idx * (metaCardW + metaGap);
      roundRect(ctx, x, metaY, metaCardW, metaH, 12);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748B';
      ctx.font = `800 11px ${FONT_SANS}`;
      ctx.fillText(item.label, x + 16, metaY + 32);

      ctx.fillStyle = '#0F172A';
      ctx.font = `800 17px ${FONT_SANS}`;
      ctx.fillText(truncateCanvasText(ctx, item.value, metaCardW - 30), x + 16, metaY + 62);
    });

    // 5. 6 Cards de KPIs em 2 Linhas x 3 Colunas
    const tripLabel = metrics.uniqueTrips === 1 ? '1 viagem' : `${metrics.uniqueTrips} viagens`;
    const kpis = [
      {
        title: 'TOTAL PALETES PROGRAMADOS',
        zh: '计划总托盘数',
        value: String(metrics.totalProgrammed),
        sub: 'Paletes / 托盘',
        c1: '#334155',
        c2: '#475569',
        border: '#64748B'
      },
      {
        title: 'ENVIADO PARA O PISO',
        zh: '已发运至产线',
        value: String(metrics.totalSentLots),
        sub: `Paletes / 托盘 (Hoje: ${metrics.palletsDispatchedToday})`,
        c1: '#14532D',
        c2: '#166534',
        border: '#22C55E'
      },
      {
        title: 'SALDO PENDENTE GERAL',
        zh: '总待发余额',
        value: String(metrics.totalPendingBalance),
        sub: 'Paletes / 托盘',
        c1: '#7F1D1D',
        c2: '#991B1B',
        border: '#EF4444'
      },
      {
        title: 'LOTES CONCLUÍDOS',
        zh: '已完成批次',
        value: `${metrics.completedLots} de ${metrics.totalLots}`,
        sub: 'Lotes / 批次',
        c1: '#4C1D95',
        c2: '#5B21B6',
        border: '#A855F7'
      },
      {
        title: 'PROGRESSO GERAL',
        zh: '总体进度',
        value: formatPct(metrics.overallProgressPct),
        sub: 'Meta consolidada / 综合达成率',
        c1: '#115E59',
        c2: '#0F766E',
        border: '#14B8A6'
      },
      {
        title: 'PALETES / HORA',
        zh: '每小时发运',
        value: String(metrics.palletsPerHour),
        sub: `Paletes / 小时 (${tripLabel})`,
        c1: '#1E3A8A',
        c2: '#0369A1',
        border: '#38BDF8'
      }
    ];

    const kpiW = (bannerW - kpiGap * 2) / 3;

    kpis.forEach((kpi, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const x = bannerX + col * (kpiW + kpiGap);
      const y = kpiStartY + row * (kpiH + kpiGap);

      const grad = ctx.createLinearGradient(x, y, x + kpiW, y + kpiH);
      grad.addColorStop(0, kpi.c1);
      grad.addColorStop(1, kpi.c2);

      roundRect(ctx, x, y, kpiW, kpiH, 14);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = kpi.border;
      ctx.stroke();

      roundRect(ctx, x + 7, y + 7, kpiW - 14, kpiH - 14, 10);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#F8FAFC';
      ctx.font = `800 12px ${FONT_SANS}`;
      ctx.fillText(kpi.title, x + 22, y + 30);

      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.font = `600 12px ${FONT_SANS}`;
      ctx.fillText(kpi.zh, x + 22, y + 48);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 34px ${FONT_SANS}`;
      ctx.fillText(kpi.value, x + 22, y + 92);

      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.font = `600 11.5px ${FONT_SANS}`;
      ctx.fillText(kpi.sub, x + 22, y + 114);
    });

    // 6. Tabela Acompanhamento dos Lotes
    ctx.textAlign = 'left';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `800 15px ${FONT_SANS}`;
    ctx.fillText('ACOMPANHAMENTO DOS LOTES / 批次跟踪表', bannerX, sectionTitleY);

    roundRect(ctx, bannerX, tableY, bannerW, tableHeight, 14);
    ctx.fillStyle = '#0D1424';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#22314F';
    ctx.stroke();

    const cols = [
      { label: 'Nº / 序号', x: bannerX + 20 },
      { label: 'LOTE ID / 批次号', x: bannerX + 120 },
      { label: 'META / 目标', x: bannerX + 420 },
      { label: 'ENVIADO / 已发', x: bannerX + 540 },
      { label: 'SALDO / 待发', x: bannerX + 675 },
      { label: '% CONCLUSÃO', x: bannerX + 800 },
      { label: 'STATUS OPERACIONAL / 运行状态', x: bannerX + 945 }
    ];

    ctx.fillStyle = '#94A3B8';
    ctx.font = `800 11.5px ${FONT_SANS}`;
    cols.forEach((col) => {
      ctx.fillText(col.label, col.x, tableY + 30);
    });

    ctx.beginPath();
    ctx.moveTo(bannerX, tableY + tableHeaderHeight);
    ctx.lineTo(bannerX + bannerW, tableY + tableHeaderHeight);
    ctx.strokeStyle = '#22314F';
    ctx.stroke();

    const rows = metrics.filteredLots;
    if (!rows.length) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = `600 14px ${FONT_SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('Nenhum lote ativo cadastrado para este turno/filtro.', W / 2, tableY + tableHeaderHeight + 36);
    } else {
      rows.forEach((lot, idx) => {
        const ry = tableY + tableHeaderHeight + idx * rowHeight;
        if (idx > 0) {
          ctx.beginPath();
          ctx.moveTo(bannerX + 14, ry);
          ctx.lineTo(bannerX + bannerW - 14, ry);
          ctx.strokeStyle = 'rgba(34, 49, 79, 0.65)';
          ctx.stroke();
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = '#94A3B8';
        ctx.font = `700 13px ${FONT_SANS}`;
        ctx.fillText(String(idx + 1).padStart(2, '0'), cols[0].x, ry + 36);

        const lotTitle = `${lot.Nome_Lote || ''}${lot.Turno_Vinculado ? ` · ${lot.Turno_Vinculado}` : ''}`;
        ctx.fillStyle = '#F8FAFC';
        ctx.font = `800 13.5px ${FONT_SANS}`;
        ctx.fillText(truncateCanvasText(ctx, lotTitle, 285), cols[1].x, ry + 28);

        ctx.fillStyle = '#64748B';
        ctx.font = `700 11.5px ${FONT_SANS}`;
        ctx.fillText(String(lot.Modelo_Base || ''), cols[1].x, ry + 47);

        ctx.fillStyle = '#F8FAFC';
        ctx.font = `700 13.5px ${FONT_SANS}`;
        ctx.fillText(String(lot.meta), cols[2].x, ry + 36);
        ctx.fillText(String(lot.sent), cols[3].x, ry + 36);
        ctx.fillText(String(lot.saldo), cols[4].x, ry + 36);
        ctx.fillText(formatPct(lot.pct), cols[5].x, ry + 36);

        const badgeX = cols[6].x;
        const badgeY = ry + 18;
        const badgeW = 195;
        const badgeH = 28;
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
        if (lot.done) {
          ctx.fillStyle = 'rgba(22, 163, 74, 0.25)';
          ctx.fill();
          ctx.strokeStyle = '#22C55E';
          ctx.stroke();
          ctx.fillStyle = '#86EFAC';
          ctx.font = `800 11px ${FONT_SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText('CONCLUÍDO / 已完成', badgeX + badgeW / 2, badgeY + 18);
        } else {
          ctx.fillStyle = 'rgba(180, 83, 9, 0.35)';
          ctx.fill();
          ctx.strokeStyle = '#D97706';
          ctx.stroke();
          ctx.fillStyle = '#FCD34D';
          ctx.font = `800 11px ${FONT_SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText('EM ANDAMENTO / 进行中', badgeX + badgeW / 2, badgeY + 18);
        }
      });
    }

    // 7. Quadro Branco Observações Operacionais / 运行备注 (PT + Chinês Simplificado)
    roundRect(ctx, bannerX, obsY, bannerW, obsH, 14);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `800 13.5px ${FONT_SANS}`;
    ctx.fillText('OBSERVAÇÕES OPERACIONAIS / 运行备注', bannerX + 24, obsY + 30);

    const pctStr = formatPct(metrics.overallProgressPct);
    const ptLines = [
      `Atingido: ${pctStr} do programado (${metrics.totalSentLots} de ${metrics.totalProgrammed} paletes).`,
      `Lotes concluídos: ${metrics.completedLots} de ${metrics.totalLots}.`,
      `Lotes com saldo pendente: ${metrics.pendingLots} (${metrics.totalPendingBalance} paletes).`
    ];
    const zhLines = [
      `达成率: ${pctStr} (已发运 ${metrics.totalSentLots} / 计划 ${metrics.totalProgrammed} 托盘)。`,
      `已完成批次: ${metrics.completedLots} / ${metrics.totalLots}。`,
      `待发批次: ${metrics.pendingLots}，总待发余额: ${metrics.totalPendingBalance} 托盘。`
    ];

    ctx.fillStyle = '#1E293B';
    ctx.font = `600 13px ${FONT_SANS}`;
    ptLines.forEach((line, i) => {
      ctx.fillText(line, bannerX + 24, obsY + 58 + i * 21);
    });

    // Linha divisória sutil entre Português e Chinês Simplificado
    ctx.beginPath();
    ctx.moveTo(bannerX + 24, obsY + 114);
    ctx.lineTo(bannerX + bannerW - 140, obsY + 114);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.font = `600 13.5px ${FONT_SANS}`;
    zhLines.forEach((line, i) => {
      ctx.fillText(line, bannerX + 24, obsY + 138 + i * 22);
    });

    // Marca d'água BYD no canto inferior direito do quadro branco
    ctx.save();
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(220, 38, 38, 0.16)';
    ctx.font = `900 36px ${FONT_SANS}`;
    ctx.fillText('BYD', bannerX + bannerW - 26, obsY + obsH - 22);
    ctx.restore();

    // 8. Rodapé sem sobreposição (28px abaixo do card branco)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94A3B8';
    ctx.font = `700 11.5px ${FONT_SANS}`;
    ctx.fillText('BYD • LOGÍSTICA INDUSTRIAL', bannerX, footerY);

    ctx.textAlign = 'right';
    ctx.fillText(`Gerado em ${formatNowTimestamp()}`, bannerX + bannerW, footerY);

    return canvas;
  }

  async function renderVisualReportImage(triggerDownloadOrShare = false) {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const selectedDate = (dateInput && dateInput.value) || todayIso();
    const selectedShift = (shiftSelect && shiftSelect.value) || 'ALL';
    const metrics = computeMetrics(selectedDate, selectedShift);

    const canvas = buildCockpitCanvas(metrics);
    lastPngFilename = `cockpit-byd-${selectedDate.replace(/-/g, '')}.png`;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    lastPngBlob = blob;
    if (lastPngUrl) URL.revokeObjectURL(lastPngUrl);
    lastPngUrl = URL.createObjectURL(blob);

    const previewImg = el('cockpitReportPreviewImg');
    if (previewImg) {
      previewImg.src = lastPngUrl;
    }

    if (triggerDownloadOrShare) {
      downloadCurrentPng();
      const previewCard = el('cockpitVisualReportCard');
      if (previewCard && typeof previewCard.scrollIntoView === 'function') {
        previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function downloadCurrentPng() {
    if (!lastPngUrl) return;
    const link = document.createElement('a');
    link.href = lastPngUrl;
    link.download = lastPngFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function shareCurrentPng() {
    if (!lastPngBlob) {
      await renderVisualReportImage(false);
    }
    if (!lastPngBlob) return;

    const file = new File([lastPngBlob], lastPngFilename, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Cockpit Logístico BYD - Entrega de Materiais',
          text: '📊 Relatório Diário de Expedição BYD / 物料配送日报'
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    downloadCurrentPng();
  }

  // =========================================================================
  // RENDERIZAÇÃO DOS CARDS WEB DO COCKPIT
  // =========================================================================
  function renderHeader(context, selectedDate, selectedShift) {
    const metaEl = el('cockpitHeaderMeta');
    if (!metaEl) return;
    const coord = context.coordinator || 'Anderson Andrade';
    const leader = context.leadership || 'Daniela Menezes';
    const shiftText = selectedShift === 'ALL' ? 'Todos os Turnos' : selectedShift;
    metaEl.textContent = `Setor: Entrega de Materiais · Coordenador: ${coord} · Liderança: ${leader} · Filtro: ${formatDateBr(selectedDate)} (${shiftText})`;
  }

  function renderKpis(metrics) {
    const grid = el('cockpitKpiGrid');
    if (!grid) return;

    grid.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Programado</div>
        <div class="kpi-value">${metrics.totalProgrammed}</div>
        <div class="kpi-sub">Meta consolidada dos lotes</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Enviado para o Piso</div>
        <div class="kpi-value" style="color:var(--success-text)">${metrics.totalSentLots}</div>
        <div class="kpi-sub">Hoje no turno: ${metrics.palletsDispatchedToday} paletes (${metrics.uniqueTrips} ${metrics.uniqueTrips === 1 ? 'viagem' : 'viagens'})</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Saldo Pendente Geral</div>
        <div class="kpi-value" style="color:var(--danger-text)">${metrics.totalPendingBalance}</div>
        <div class="kpi-sub">Paletes restantes nos lotes</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Lotes Concluídos</div>
        <div class="kpi-value">${metrics.completedLots} de ${metrics.totalLots}</div>
        <div class="kpi-sub">Progresso: ${formatPct(metrics.overallProgressPct)} · ${metrics.palletsPerHour} pal/h</div>
      </article>
    `;
  }

  function renderLotsProgress(lots) {
    const container = el('cockpitLotsGrid');
    if (!container) return;

    if (!lots.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lote cadastrado ou movimentado para este turno.</div>';
      return;
    }

    container.innerHTML = lots.map((lot) => {
      const pctRounded = Math.min(100, Math.round(lot.pct));
      return `
        <article class="pending-lot">
          <div class="history-top" style="align-items:center;margin-bottom:6px">
            <h4 class="pending-lot-title" style="margin:0">
              ${escapeHtml(lot.Nome_Lote)} · ${escapeHtml(lot.Modelo_Base)}
              ${lot.Turno_Vinculado ? `<span class="muted-small">(${escapeHtml(lot.Turno_Vinculado)})</span>` : ''}
            </h4>
            <span class="status-tag ${lot.done ? 'ok' : ''}" style="${lot.done ? '' : 'background:var(--byd-cyan-soft);color:var(--byd-cyan-text)'}">
              ${lot.done ? 'CONCLUÍDO · 100%' : `${formatPct(lot.pct)} · FALTAM ${lot.saldo}`}
            </span>
          </div>

          <div class="pending-component-meta" style="margin-bottom:5px">
            <span>Entregue: ${lot.sent} / ${lot.meta} paletes</span>
            <span>Saldo: ${lot.saldo} paletes</span>
          </div>
          <div class="pending-track" style="margin-bottom:8px">
            <span style="width:${pctRounded}%"></span>
          </div>

          <div class="meta-row" style="margin-top:4px">
            ${lot.items.map((item) => `
              <span class="meta-badge">
                ${escapeHtml(item.Componente)}: <strong>${Number(item.Enviado) || 0}/${Number(item.Meta) || 0}</strong>
              </span>
            `).join('')}
          </div>
        </article>
      `;
    }).join('');
  }

  function renderModelsVolume(validRecords) {
    const container = el('cockpitModelsGrid');
    if (!container) return;

    const map = new Map();
    validRecords.forEach((r) => {
      const model = String(r.Modelo_Base || 'OUTROS').trim();
      map.set(model, (map.get(model) || 0) + (Number(r.Qtd_Enviada) || 0));
    });

    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, qty]) => sum + qty, 0);

    if (!entries.length) {
      container.innerHTML = '<div class="empty-state">Sem movimentação por modelo na data/turno selecionados.</div>';
      return;
    }

    container.innerHTML = entries.map(([model, qty]) => {
      const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
      return `
        <div class="pending-lot" style="padding:10px 12px">
          <div class="pending-component-meta" style="margin-bottom:6px">
            <span><strong>${escapeHtml(model)}</strong></span>
            <span>${qty} paletes (${pct}%)</span>
          </div>
          <div class="pending-track">
            <span style="width:${pct}%"></span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderDriversProductivity(validRecords) {
    const container = el('cockpitDriversList');
    if (!container) return;

    const byDriver = new Map();
    validRecords.forEach((r) => {
      const name = String(r.Motorista || 'NÃO INFORMADO').trim().toUpperCase();
      if (!byDriver.has(name)) {
        byDriver.set(name, { name, pallets: 0, trips: new Set(), fleets: new Set() });
      }
      const entry = byDriver.get(name);
      entry.pallets += Number(r.Qtd_Enviada) || 0;
      entry.trips.add(r.ID_Viagem || `${r.Data_Ref}|${r.Hora_Ref}|${r.Frota}`);
      if (r.Frota) entry.fleets.add(String(r.Frota).trim().toUpperCase());
    });

    const list = [...byDriver.values()].sort((a, b) => b.pallets - a.pallets);
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">Nenhuma entrega registrada por motorista neste filtro.</div>';
      return;
    }

    container.innerHTML = list.map((item, idx) => `
      <div class="user-row">
        <div>
          <div class="user-name">#${idx + 1} · ${escapeHtml(item.name)}</div>
          <div class="user-detail">
            ${item.trips.size} viagem(ns) · Frota(s): ${escapeHtml([...item.fleets].join(', ') || '—')}
          </div>
        </div>
        <div class="history-qty">${item.pallets} paletes</div>
      </div>
    `).join('');
  }

  function renderBilingualSummary(context, metrics) {
    const box = el('cockpitBilingualCard');
    if (!box) return;

    const coord = context.coordinator || 'Anderson Andrade';
    const leader = context.leadership || 'Daniela Menezes';
    const resp = context.operator || 'Eric Miranda';
    const pctStr = formatPct(metrics.overallProgressPct);

    const modelMap = new Map();
    metrics.validRecords.forEach((r) => {
      const m = String(r.Modelo_Base || 'OUTROS').trim();
      modelMap.set(m, (modelMap.get(m) || 0) + (Number(r.Qtd_Enviada) || 0));
    });
    const modelLines = modelMap.size
      ? [...modelMap.entries()].sort((a, b) => b[1] - a[1]).map(([m, q]) => `• ${m}: ${q} paletes (托盘)`).join('\n')
      : '• Sem movimentação hoje / 今日暂无配送记录';

    const lotLines = metrics.filteredLots.length
      ? metrics.filteredLots.map((l) => {
          const statusZh = l.done ? '已完成' : '进行中';
          return `• ${l.Nome_Lote} [${l.Modelo_Base}]: ${l.sent}/${l.meta} (${formatPct(l.pct)} · ${statusZh})`;
        }).join('\n')
      : '• Nenhum lote ativo / 暂无活跃批次';

    box.textContent = [
      '📊 COCKPIT LOGÍSTICO BYD · ENTREGA DE MATERIAIS / 物流驾驶舱 - 物料配送',
      `📅 Data / 日期: ${formatDateBr(metrics.selectedDate)}`,
      `🕒 Turno / 班次: ${shiftToChinese(metrics.selectedShift)}`,
      `👔 Coordenador: ${coord} | Liderança: ${leader} | Responsável: ${resp}`,
      '--------------------------------------------------',
      `📦 Programado / 计划总托盘数: ${metrics.totalProgrammed} paletes`,
      `✅ Enviado / 已发运至产线: ${metrics.totalSentLots} paletes (Hoje: ${metrics.palletsDispatchedToday})`,
      `⏳ Saldo Pendente / 总待发余额: ${metrics.totalPendingBalance} paletes`,
      `📈 Progresso / 总体进度: ${pctStr} | Lotes Concluídos: ${metrics.completedLots} de ${metrics.totalLots}`,
      `🚛 Viagens / 运输趟次: ${metrics.uniqueTrips} | Paletes/Hora: ${metrics.palletsPerHour}`,
      '',
      '🚗 VOLUME POR MODELO (HOJE) / 按车型统计:',
      modelLines,
      '',
      '📋 ACOMPANHAMENTO DOS LOTES / 批次跟踪:',
      lotLines
    ].join('\n');
  }

  function renderAuditTable(filteredRecords) {
    const tbody = el('cockpitTableBody');
    if (!tbody) return;

    if (!filteredRecords.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">Nenhum lançamento encontrado para esta data/turno.</td></tr>';
      return;
    }

    const sorted = filteredRecords.slice().sort((a, b) =>
      String(b.DataHora || '').localeCompare(String(a.DataHora || ''))
    );

    tbody.innerHTML = sorted.map((r) => {
      const voided = String(r.Status || '').toUpperCase() === 'ESTORNADO';
      return `
        <tr>
          <td>${escapeHtml(formatTime(r))}</td>
          <td>${escapeHtml(r.Turno || '')}</td>
          <td>
            <strong>${escapeHtml(r.Nome_Lote || '')}</strong> · ${escapeHtml(r.Componente || '')}
            ${voided && r.Motivo_Estorno ? `<div class="muted-small" style="color:var(--danger-text)">Motivo: ${escapeHtml(r.Motivo_Estorno)}</div>` : ''}
          </td>
          <td><strong>${Number(r.Qtd_Enviada) || 0}</strong></td>
          <td>${escapeHtml(r.Motorista || '')} · ${escapeHtml(r.Frota || '')}</td>
          <td>${escapeHtml(r.Operador || '')}</td>
          <td><span class="status-tag ${voided ? 'void' : 'ok'}">${voided ? 'ESTORNADO' : 'ENTREGUE'}</span></td>
        </tr>
      `;
    }).join('');
  }

  function render() {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const selectedDate = (dateInput && dateInput.value) || todayIso();
    const selectedShift = (shiftSelect && shiftSelect.value) || 'ALL';

    const metrics = computeMetrics(selectedDate, selectedShift);

    renderHeader(lastContext, selectedDate, selectedShift);
    renderKpis(metrics);
    renderLotsProgress(metrics.filteredLots);
    renderModelsVolume(metrics.validRecords);
    renderDriversProductivity(metrics.validRecords);
    renderBilingualSummary(lastContext, metrics);
    renderAuditTable(metrics.filteredRecords);
    renderVisualReportImage(false);
  }

  function update(records = [], context = {}) {
    lastRecords = Array.isArray(records) ? records : [];
    lastContext = context || {};
    ensureControls(lastContext);
    render();
  }

  return { update, renderVisualReportImage };
})();