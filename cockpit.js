const Cockpit = (() => {
  'use strict';

  const DEFAULT_MODELS = {
    EQE: { total: 233, components: [{ name: 'Aramados baixos', meta: 60 }, { name: 'Aramados altos', meta: 38 }, { name: 'Caixarias', meta: 135 }] },
    HA2: { total: 240, components: [{ name: 'Aramados baixos', meta: 60 }, { name: 'Aramados altos', meta: 60 }, { name: 'Escapamentos', meta: 120 }] },
    'SA2/SA6': { total: 120, components: [{ name: 'Barcas', meta: 40 }, { name: 'Motores / Eixos', meta: 40 }, { name: 'Aramados de Caixas', meta: 40 }] },
    SC3: { total: 120, components: [{ name: 'Aramados baixos', meta: 30 }, { name: 'Aramados altos', meta: 30 }, { name: 'Caixarias', meta: 60 }] },
    PBP: { total: 387, components: [{ name: 'Aramados altos e baixos', meta: 60 }, { name: 'Caixarias', meta: 87 }, { name: 'Jantes', meta: 240 }] }
  };

  let latestRecords = [];
  let latestContext = {};
  let eventsBound = false;

  const el = (id) => document.getElementById(id);
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

  function todayStr(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function formatBrDate(isoDate) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '--/--/----';
  }

  function formatShortDate(isoDate) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}` : '--/--';
  }

  function formatNowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function formatHour(record) {
    const t = String(record.Hora_Ref || '');
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return t.slice(0, 5);
    const d = new Date(record.DataHora || '');
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function normDate(record) {
    const m = String(record.Data_Ref || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(record.DataHora || '');
    return Number.isNaN(d.getTime()) ? '' : todayStr(d);
  }

  function normTurn(value) {
    const s = String(value || '').trim();
    if (!s || /^todos/i.test(s) || /^geral$/i.test(s)) return 'ALL';
    const m = s.match(/([ABC])$/i);
    return m ? `Turno ${m[1].toUpperCase()}` : s;
  }

  function normModel(model) {
    const s = String(model || '').trim().toUpperCase().replace(/\s+/g, '');
    if (s === 'SA2' || s === 'SA6' || s === 'SA2/SA6') return 'SA2/SA6';
    return s;
  }

  function showToast(msg) {
    const toast = el('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function catalogMap(context) {
    const map = {};
    Object.entries(DEFAULT_MODELS).forEach(([k, v]) => {
      map[k] = { total: v.total, components: v.components.map((c) => ({ ...c })) };
    });
    if (Array.isArray(context.models)) {
      context.models.forEach((m) => {
        const key = normModel(m.Modelo_Base);
        if (!key || !Array.isArray(m.Componentes)) return;
        map[key] = {
          total: Number(m.Total_Meta) || m.Componentes.reduce((s, c) => s + (Number(c.Meta) || 0), 0),
          components: m.Componentes.map((c) => ({ name: String(c.Nome || '').trim(), meta: Number(c.Meta) || 0 }))
        };
      });
    }
    return map;
  }

  function ensureImageControls() {
    const copyBtn = el('copyChineseReportButton');
    if (copyBtn && !el('generateCockpitImageButton')) {
      const header = copyBtn.parentElement;
      const wrapper = document.createElement('div');
      wrapper.className = 'action-row';
      header.replaceChild(wrapper, copyBtn);

      const imgBtn = document.createElement('button');
      imgBtn.id = 'generateCockpitImageButton';
      imgBtn.type = 'button';
      imgBtn.className = 'button button-primary';
      imgBtn.textContent = '🖼️ Gerar Imagem (PNG)';
      imgBtn.addEventListener('click', () => generateCockpitImage(true));

      wrapper.appendChild(imgBtn);
      wrapper.appendChild(copyBtn);
    }

    const cockpitView = el('cockpitView');
    if (cockpitView && !el('cockpitImagePreviewCard')) {
      const card = document.createElement('article');
      card.id = 'cockpitImagePreviewCard';
      card.className = 'card';
      card.hidden = true;
      card.innerHTML = `
        <div class="card-header">
          <h3 class="card-title">Imagem do Cockpit Gerada (PNG)</h3>
          <button id="downloadCockpitImageAgain" class="button button-cyan" type="button">⬇️ Baixar PNG</button>
        </div>
        <img id="cockpitGeneratedImg" alt="Cockpit Logístico BYD" style="width:100%;border-radius:12px;margin-top:12px;border:1px solid var(--border);display:block;">
      `;
      const bilingualCard = el('cockpitBilingualCard')?.closest('.card');
      if (bilingualCard && bilingualCard.parentNode) {
        bilingualCard.parentNode.insertBefore(card, bilingualCard.nextSibling);
      } else {
        cockpitView.appendChild(card);
      }
      el('downloadCockpitImageAgain')?.addEventListener('click', () => generateCockpitImage(true));
    }
  }

  function bindEvents() {
    ensureImageControls();
    if (eventsBound) return;
    eventsBound = true;

    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const copyBtn = el('copyChineseReportButton');

    if (dateInput) {
      if (!dateInput.value) dateInput.value = todayStr();
      dateInput.addEventListener('change', () => render());
    }
    if (shiftSelect) {
      shiftSelect.addEventListener('change', () => render());
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', copyBilingualReport);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  function copyBilingualReport() {
    const box = el('cockpitBilingualCard');
    const text = box ? (box.value !== undefined ? box.value : box.textContent) : '';
    if (!text.trim()) return;
    copyText(text).then(() => showToast('📋 Resumo Bilíngue (PT/ZH) copiado!'));
  }

  function getFilters() {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    return {
      targetDate: (dateInput && dateInput.value) ? dateInput.value : todayStr(),
      targetShift: shiftSelect ? normTurn(shiftSelect.value) : 'ALL'
    };
  }

  function filterRecordsList(includeVoided = false) {
    const { targetDate, targetShift } = getFilters();
    return latestRecords.filter((r) => {
      const isVoid = String(r.Status || '').toUpperCase() === 'ESTORNADO';
      if (!includeVoided && isVoid) return false;
      if (targetDate && normDate(r) !== targetDate) return false;
      if (targetShift !== 'ALL' && normTurn(r.Turno) !== targetShift) return false;
      return true;
    });
  }

  function buildLotStats(catalog) {
    const { targetShift } = getFilters();
    const progressList = Array.isArray(latestContext.progressLots) ? latestContext.progressLots : [];
    const activeLots = Array.isArray(latestContext.activeLots) ? latestContext.activeLots : [];
    const validRecords = latestRecords.filter((r) => String(r.Status || '').toUpperCase() !== 'ESTORNADO');

    const map = new Map();

    const ensureLot = (name, model, shift = '') => {
      const mKey = normModel(model);
      const lName = String(name || '').trim();
      if (!lName || !mKey) return null;
      const key = `${mKey}|${lName.toLocaleLowerCase('pt-BR')}`;
      if (!map.has(key)) {
        const def = catalog[mKey] || { total: 0, components: [] };
        map.set(key, {
          name: lName,
          model: mKey,
          shift: normTurn(shift) === 'ALL' ? '' : normTurn(shift),
          totalMeta: def.total,
          items: def.components.map((c) => ({ name: c.name, meta: c.meta, sent: 0 }))
        });
      }
      return map.get(key);
    };

    activeLots.forEach((l) => ensureLot(l.name || l.Nome_Lote, l.model || l.Modelo_Base, l.shift || l.Turno_Vinculado));

    if (progressList.length) {
      progressList.forEach((p) => {
        const entry = ensureLot(p.Nome_Lote, p.Modelo_Base, p.Turno_Vinculado);
        if (!entry) return;
        if (Number(p.Total_Meta) > 0) entry.totalMeta = Number(p.Total_Meta);
        if (Array.isArray(p.Itens) && p.Itens.length) {
          entry.items = p.Itens.map((it) => ({
            name: String(it.Componente || '').trim(),
            meta: Number(it.Meta) || 0,
            sent: Number(it.Enviado) || 0
          }));
        }
      });
    } else {
      validRecords.forEach((r) => {
        const entry = ensureLot(r.Nome_Lote, r.Modelo_Base, r.Turno);
        if (!entry) return;
        const comp = entry.items.find((c) => c.name.toLocaleLowerCase('pt-BR') === String(r.Componente || '').trim().toLocaleLowerCase('pt-BR'));
        if (comp) comp.sent += Number(r.Qtd_Enviada) || 0;
        else entry.items.push({ name: String(r.Componente || '').trim(), meta: 0, sent: Number(r.Qtd_Enviada) || 0 });
      });
    }

    return [...map.values()].filter((lot) => targetShift === 'ALL' || !lot.shift || lot.shift === targetShift);
  }

  function computeMetrics(dayRecords, lots) {
    const { targetDate, targetShift } = getFilters();
    const todayPallets = dayRecords.reduce((s, r) => s + (Number(r.Qtd_Enviada) || 0), 0);
    const totalTrips = new Set(dayRecords.map((r) => r.ID_Viagem || r.ID_Apontamento)).size;

    let totalMeta = 0;
    let totalSent = 0;
    let doneLots = 0;

    const lotRows = lots.map((l, idx) => {
      const sent = l.items.reduce((s, c) => s + c.sent, 0);
      const meta = l.totalMeta || l.items.reduce((s, c) => s + c.meta, 0);
      const balance = Math.max(0, meta - sent);
      const pctNum = meta > 0 ? Math.min(100, (sent / meta) * 100) : 0;
      const isDone = meta > 0 && sent >= meta;
      if (isDone) doneLots += 1;
      totalMeta += meta;
      totalSent += sent;
      return {
        index: String(idx + 1).padStart(2, '0'),
        label: l.name.toUpperCase().includes(l.model) ? l.name : `${l.name} - ${l.model}`,
        meta,
        sent,
        balance,
        pctText: `${pctNum % 1 === 0 ? pctNum.toFixed(0) : pctNum.toFixed(1).replace('.', ',')}%`,
        isDone,
        status: isDone ? 'CONCLUÍDO / 已完成' : (sent > 0 ? 'EM ANDAMENTO / 进行中' : 'PENDENTE / 待发')
      };
    });

    const balance = Math.max(0, totalMeta - totalSent);
    const pendingLots = Math.max(0, lots.length - doneLots);
    const pctNum = totalMeta > 0 ? Math.min(100, (totalSent / totalMeta) * 100) : 0;
    const pctStr = pctNum.toFixed(1).replace('.', ',');

    let activeHours = 1;
    if (dayRecords.length > 1) {
      const times = dayRecords
        .map((r) => new Date(r.DataHora || '').getTime())
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => a - b);
      if (times.length >= 2) {
        const diffHours = (times[times.length - 1] - times[0]) / 3600000;
        activeHours = Math.min(8, Math.max(1, diffHours));
      }
    }
    const palletsPerHour = todayPallets > 0 ? Math.round(todayPallets / activeHours) : 0;

    return {
      targetDate,
      shiftDisplay: targetShift === 'ALL' ? 'Geral' : targetShift,
      coordinator: latestContext.coordinator || 'Anderson Andrade',
      leadership: latestContext.leadership || 'Daniela Menezes',
      responsible: latestContext.operator || 'Eric Miranda',
      totalMeta,
      totalSent,
      todayPallets,
      balance,
      doneLots,
      pendingLots,
      totalLots: lots.length,
      pctStr,
      palletsPerHour,
      totalTrips,
      lotRows
    };
  }

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

  function generateCockpitImage(download = false) {
    const catalog = catalogMap(latestContext);
    const dayRecords = filterRecordsList(false);
    const lots = buildLotStats(catalog);
    const m = computeMetrics(dayRecords, lots);

    const W = 1400;
    const rowH = 46;
    const rowsCount = Math.max(1, m.lotRows.length);
    const tableBodyH = rowsCount * rowH + 16;
    const tableH = 44 + tableBodyH;
    const H = 640 + tableH + 250;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const font = '"Segoe UI", Roboto, "Microsoft YaHei", Arial, sans-serif';

    // Fundo principal
    ctx.fillStyle = '#070C17';
    ctx.fillRect(0, 0, W, H);

    // Logo BYD (canto superior esquerdo)
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(92, 62, 62, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#D91A21';
    ctx.beginPath();
    ctx.ellipse(92, 62, 58, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 26px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BYD', 92, 63);
    ctx.restore();

    // Título central
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 30px ${font}`;
    ctx.fillText('COCKPIT LOGÍSTICO - ENTREGA DE MATERIAIS', W / 2, 56);

    ctx.fillStyle = '#94A3B8';
    ctx.font = `700 18px ${font}`;
    ctx.fillText('物流驾驶舱 - 物料配送', W / 2, 84);

    // Banner Relatório Diário
    roundRect(ctx, 30, 112, W - 60, 48, 12);
    ctx.fillStyle = '#6C370C';
    ctx.fill();
    ctx.strokeStyle = '#C26D1F';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#FEF3C7';
    ctx.font = `800 18px ${font}`;
    ctx.fillText('RELATÓRIO DIÁRIO DE EXPEDIÇÃO / 每日发运报告', W / 2, 142);

    // 5 Cards brancos de Metadados
    const metaCards = [
      { label: 'DATA / 日期', value: formatShortDate(m.targetDate) },
      { label: 'COORDENADOR', value: m.coordinator },
      { label: 'LIDERANÇA', value: m.leadership },
      { label: 'RESPONSÁVEL', value: m.responsible },
      { label: 'TURNO / 班次', value: m.shiftDisplay }
    ];
    const gap = 16;
    const metaW = (W - 60 - gap * 4) / 5;
    metaCards.forEach((c, i) => {
      const x = 30 + i * (metaW + gap);
      const y = 178;
      roundRect(ctx, x, y, metaW, 82, 14);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748B';
      ctx.font = `800 12px ${font}`;
      ctx.fillText(c.label, x + 18, y + 28);

      ctx.fillStyle = '#0F172A';
      ctx.font = `800 22px ${font}`;
      ctx.fillText(String(c.value).slice(0, 20), x + 18, y + 60);
    });

    // 6 Cards de KPIs (2 linhas x 3 colunas)
    const kpis = [
      {
        title: 'TOTAL PALETES PROGRAMADOS',
        zh: '计划总托盘数',
        val: String(m.totalMeta),
        sub: 'Paletes / 托盘',
        bg: '#3B4859',
        border: '#64748B'
      },
      {
        title: 'ENVIADO PARA O PISO',
        zh: '已发运至产线',
        val: String(m.totalSent),
        sub: `Paletes / 托盘 (Hoje: ${m.todayPallets})`,
        bg: '#165B33',
        border: '#22C55E'
      },
      {
        title: 'SALDO PENDENTE GERAL',
        zh: '总待发余额',
        val: String(m.balance),
        sub: 'Paletes / 托盘',
        bg: '#7F1D1D',
        border: '#EF4444'
      },
      {
        title: 'LOTES CONCLUÍDOS',
        zh: '已完成批次',
        val: `${m.doneLots} de ${m.totalLots}`,
        sub: 'Lotes / 批次',
        bg: '#4C1D95',
        border: '#A855F7'
      },
      {
        title: 'PROGRESSO GERAL',
        zh: '总体进度',
        val: `${m.pctStr}%`,
        sub: 'Meta consolidada / 综合达成率',
        bg: '#0F5E4E',
        border: '#14B8A6'
      },
      {
        title: 'PALETES / HORA',
        zh: '每小时发运',
        val: String(m.palletsPerHour),
        sub: `Paletes / 小时 (${m.totalTrips} viagens / 车次)`,
        bg: '#1E3A8A',
        border: '#3B82F6'
      }
    ];

    const kpiW = (W - 60 - gap * 2) / 3;
    const kpiH = 128;
    kpis.forEach((k, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 30 + col * (kpiW + gap);
      const y = 282 + row * (kpiH + gap);

      roundRect(ctx, x, y, kpiW, kpiH, 16);
      ctx.fillStyle = k.bg;
      ctx.fill();
      ctx.strokeStyle = k.border;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#E2E8F0';
      ctx.font = `800 13px ${font}`;
      ctx.fillText(k.title, x + 22, y + 28);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = `600 13px ${font}`;
      ctx.fillText(k.zh, x + 22, y + 48);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 40px ${font}`;
      ctx.fillText(k.val, x + 22, y + 92);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = `600 13px ${font}`;
      ctx.fillText(k.sub, x + 22, y + 114);
    });

    // Título da Tabela de Lotes
    const tableTitleY = 582;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 17px ${font}`;
    ctx.fillText('ACOMPANHAMENTO DOS LOTES / 批次跟踪表', 30, tableTitleY);

    // Container da Tabela
    const tableY = tableTitleY + 14;
    roundRect(ctx, 30, tableY, W - 60, tableH, 14);
    ctx.fillStyle = '#0D1526';
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cabeçalho da Tabela
    roundRect(ctx, 30, tableY, W - 60, 44, 14);
    ctx.fillStyle = '#141E33';
    ctx.fill();

    const cols = [
      { label: 'N° / 序号', x: 75, align: 'center' },
      { label: 'LOTE ID / 批次号', x: 170, align: 'left' },
      { label: 'META / 目标', x: 540, align: 'center' },
      { label: 'ENVIADO / 已发', x: 700, align: 'center' },
      { label: 'SALDO / 待发', x: 860, align: 'center' },
      { label: '% CONCLUSÃO', x: 1020, align: 'center' },
      { label: 'STATUS OPERACIONAL / 运行状态', x: 1225, align: 'center' }
    ];

    ctx.fillStyle = '#94A3B8';
    ctx.font = `800 13px ${font}`;
    cols.forEach((c) => {
      ctx.textAlign = c.align;
      ctx.fillText(c.label, c.x, tableY + 27);
    });

    if (!m.lotRows.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94A3B8';
      ctx.font = `600 15px ${font}`;
      ctx.fillText('Nenhum lote ativo cadastrado para este turno/filtro.', W / 2, tableY + 44 + tableBodyH / 2 + 5);
    } else {
      m.lotRows.forEach((r, idx) => {
        const ry = tableY + 44 + idx * rowH;
        if (idx > 0) {
          ctx.strokeStyle = '#1E293B';
          ctx.beginPath();
          ctx.moveTo(46, ry);
          ctx.lineTo(W - 46, ry);
          ctx.stroke();
        }

        ctx.fillStyle = '#E2E8F0';
        ctx.font = `700 14px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText(r.index, 75, ry + 29);

        ctx.textAlign = 'left';
        ctx.font = `800 14px ${font}`;
        ctx.fillText(r.label.slice(0, 32), 170, ry + 29);

        ctx.textAlign = 'center';
        ctx.font = `700 14px ${font}`;
        ctx.fillText(String(r.meta), 540, ry + 29);
        ctx.fillText(String(r.sent), 700, ry + 29);
        ctx.fillText(String(r.balance), 860, ry + 29);
        ctx.fillText(r.pctText, 1020, ry + 29);

        // Badge de Status
        const badgeW = 210;
        const badgeH = 28;
        const bx = 1225 - badgeW / 2;
        const by = ry + 10;
        roundRect(ctx, bx, by, badgeW, badgeH, 6);
        ctx.fillStyle = r.isDone ? '#15803D' : (r.sent > 0 ? '#1D4ED8' : '#92400E');
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `800 12px ${font}`;
        ctx.fillText(r.status, 1225, by + 18);
      });
    }

    // Card Branco de Observações Operacionais
    const obsY = tableY + tableH + 22;
    const obsH = 195;
    roundRect(ctx, 30, obsY, W - 60, obsH, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0F172A';
    ctx.font = `900 16px ${font}`;
    ctx.fillText('OBSERVAÇÕES OPERACIONAIS / 运行备注', 58, obsY + 34);

    ctx.fillStyle = '#1E293B';
    ctx.font = `600 14px ${font}`;
    ctx.fillText(`Atingido: ${m.pctStr}% do programado (${m.totalSent} de ${m.totalMeta} paletes).`, 58, obsY + 62);
    ctx.fillText(`Lotes concluídos: ${m.doneLots} de ${m.totalLots}.`, 58, obsY + 84);
    ctx.fillText(`Lotes com saldo pendente: ${m.pendingLots} (${m.balance} paletes).`, 58, obsY + 106);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(58, obsY + 118);
    ctx.lineTo(W - 180, obsY + 118);
    ctx.stroke();

    ctx.fillText(`达成率：${m.pctStr}%（已发运 ${m.totalSent} / 计划 ${m.totalMeta} 托盘）。`, 58, obsY + 140);
    ctx.fillText(`已完成批次：${m.doneLots} / ${m.totalLots}。`, 58, obsY + 162);
    ctx.fillText(`待发批次：${m.pendingLots}，总待发余额：${m.balance} 托盘。`, 58, obsY + 184);

    // Marca d'água BYD no card branco
    ctx.textAlign = 'right';
    ctx.fillStyle = '#F1D4D6';
    ctx.font = `900 34px ${font}`;
    ctx.fillText('BYD', W - 60, obsY + 178);

    // Rodapé externo
    const footY = obsY + obsH + 24;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94A3B8';
    ctx.font = `800 13px ${font}`;
    ctx.fillText('BYD • LOGÍSTICA INDUSTRIAL', 30, footY);

    ctx.textAlign = 'right';
    ctx.fillText(`Gerado em ${formatNowStamp()}`, W - 30, footY);

    const dataUrl = canvas.toDataURL('image/png');
    const previewCard = el('cockpitImagePreviewCard');
    const previewImg = el('cockpitGeneratedImg');
    if (previewCard && previewImg) {
      previewImg.src = dataUrl;
      previewCard.hidden = false;
    }

    if (download) {
      const slugShift = m.shiftDisplay.toLowerCase().replace(/\s+/g, '-');
      const link = document.createElement('a');
      link.download = `cockpit-byd-${m.targetDate.replace(/-/g, '')}-${slugShift}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`🖼️ Imagem gerada (${m.shiftDisplay})!`);
    }
  }

  function renderHeaderMeta(dayRecords, lots) {
    const metaEl = el('cockpitHeaderMeta');
    if (!metaEl) return;
    const { targetDate, targetShift } = getFilters();
    const coord = latestContext.coordinator || 'Anderson Andrade';
    const lead = latestContext.leadership || 'Daniela Menezes';
    const turnText = targetShift === 'ALL' ? 'Todos os Turnos' : targetShift;
    metaEl.textContent = `Data: ${formatBrDate(targetDate)} · ${turnText} · Coordenador: ${coord} · Liderança: ${lead} · ${lots.length} lote(s) · ${dayRecords.length} lançamento(s)`;
  }

  function renderKpis(dayRecords, lots) {
    const grid = el('cockpitKpiGrid');
    if (!grid) return;

    const totalPallets = dayRecords.reduce((s, r) => s + (Number(r.Qtd_Enviada) || 0), 0);
    const totalTrips = new Set(dayRecords.map((r) => r.ID_Viagem || r.ID_Apontamento)).size;
    const activeDrivers = new Set(dayRecords.map((r) => String(r.Motorista || '').trim().toUpperCase()).filter(Boolean)).size;

    let totalMeta = 0;
    let totalSent = 0;
    lots.forEach((l) => {
      totalMeta += l.totalMeta || l.items.reduce((s, c) => s + c.meta, 0);
      totalSent += l.items.reduce((s, c) => s + c.sent, 0);
    });
    const balance = Math.max(0, totalMeta - totalSent);

    grid.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Paletes no Dia</div>
        <div class="kpi-value">${totalPallets}</div>
        <div class="kpi-sub">${totalTrips} viagem(ns) registradas</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Saldo Restante Lotes</div>
        <div class="kpi-value">${balance}</div>
        <div class="kpi-sub">${totalSent} / ${totalMeta} paletes entregues</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Lotes Monitorados</div>
        <div class="kpi-value">${lots.length}</div>
        <div class="kpi-sub">${activeDrivers} motorista(s) ativos no dia</div>
      </article>`;
  }

  function renderLotProgress(lots) {
    const container = el('cockpitLotsGrid');
    if (!container) return;

    if (!lots.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lote cadastrado ou movimentado para este filtro.</div>';
      return;
    }

    container.innerHTML = lots.map((lot) => {
      const sentTotal = lot.items.reduce((s, c) => s + c.sent, 0);
      const metaTotal = lot.totalMeta || lot.items.reduce((s, c) => s + c.meta, 0);
      const pct = metaTotal > 0 ? Math.min(100, Math.round((sentTotal / metaTotal) * 100)) : 0;
      const done = metaTotal > 0 && sentTotal >= metaTotal;

      return `
        <article class="pending-lot">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="font-size:.95rem;">${escapeHtml(lot.name)} · ${escapeHtml(lot.model)}${lot.shift ? ` (${escapeHtml(lot.shift)})` : ''}</strong>
            <span class="status-tag ${done ? 'ok' : ''}">${sentTotal}/${metaTotal} paletes (${pct}%)</span>
          </div>
          <div class="pending-track" style="margin-bottom:8px;"><span style="width:${pct}%"></span></div>
          <div style="display:grid;gap:4px;font-size:.82rem;">
            ${lot.items.map((c) => {
              const saldo = Math.max(0, c.meta - c.sent);
              return `<div style="display:flex;justify-content:space-between;opacity:.9;">
                <span>${escapeHtml(c.name)}</span>
                <span><strong>${c.sent}/${c.meta}</strong> · Saldo: ${saldo}</span>
              </div>`;
            }).join('')}
          </div>
        </article>`;
    }).join('');
  }

  function renderModelVolume(dayRecords) {
    const container = el('cockpitModelsGrid');
    if (!container) return;

    if (!dayRecords.length) {
      container.innerHTML = '<div class="empty-state">Nenhuma movimentação registrada na data selecionada.</div>';
      return;
    }

    const byModel = new Map();
    let grandTotal = 0;
    dayRecords.forEach((r) => {
      const model = normModel(r.Modelo_Base) || 'OUTROS';
      const qty = Number(r.Qtd_Enviada) || 0;
      byModel.set(model, (byModel.get(model) || 0) + qty);
      grandTotal += qty;
    });

    const sorted = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
    container.innerHTML = sorted.map(([model, qty]) => {
      const pct = grandTotal > 0 ? Math.round((qty / grandTotal) * 100) : 0;
      return `
        <div>
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:4px;">
            <strong>${escapeHtml(model)}</strong>
            <span>${qty} paletes (${pct}%)</span>
          </div>
          <div class="pending-track"><span style="width:${pct}%"></span></div>
        </div>`;
    }).join('');
  }

  function renderDriverProductivity(dayRecords) {
    const container = el('cockpitDriversList');
    if (!container) return;

    if (!dayRecords.length) {
      container.innerHTML = '<div class="empty-state">Sem viagens registradas para calcular produtividade.</div>';
      return;
    }

    const drivers = new Map();
    dayRecords.forEach((r) => {
      const name = String(r.Motorista || 'NÃO INFORMADO').trim().toUpperCase();
      if (!drivers.has(name)) drivers.set(name, { pallets: 0, trips: new Set() });
      const entry = drivers.get(name);
      entry.pallets += Number(r.Qtd_Enviada) || 0;
      entry.trips.add(r.ID_Viagem || r.ID_Apontamento);
    });

    const sorted = [...drivers.entries()].sort((a, b) => b[1].pallets - a[1].pallets);
    const topPallets = sorted[0][1].pallets || 1;

    container.innerHTML = sorted.map(([driver, info], idx) => {
      const pct = Math.round((info.pallets / topPallets) * 100);
      return `
        <div>
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:4px;">
            <span><strong>#${idx + 1} ${escapeHtml(driver)}</strong></span>
            <span>${info.pallets} paletes · ${info.trips.size} viagem(ns)</span>
          </div>
          <div class="pending-track"><span style="width:${pct}%"></span></div>
        </div>`;
    }).join('');
  }

  function renderBilingualSummary(dayRecords, lots) {
    const box = el('cockpitBilingualCard');
    if (!box) return;

    const { targetDate, targetShift } = getFilters();
    const shiftLabel = targetShift !== 'ALL' ? targetShift : 'Todos os Turnos (全班次)';
    const coordinator = latestContext.coordinator || 'Anderson Andrade';
    const leadership = latestContext.leadership || 'Daniela Menezes';
    const responsible = latestContext.operator || 'Eric Miranda';

    const totalPallets = dayRecords.reduce((s, r) => s + (Number(r.Qtd_Enviada) || 0), 0);
    const totalTrips = new Set(dayRecords.map((r) => r.ID_Viagem || r.ID_Apontamento)).size;

    const modelLines = [];
    const byModel = new Map();
    dayRecords.forEach((r) => {
      const m = normModel(r.Modelo_Base) || 'OUTROS';
      byModel.set(m, (byModel.get(m) || 0) + (Number(r.Qtd_Enviada) || 0));
    });
    [...byModel.entries()].sort((a, b) => b[1] - a[1]).forEach(([m, q]) => {
      modelLines.push(`• ${m}: ${q} paletes (托盘)`);
    });

    const lotLines = lots.map((l) => {
      const sent = l.items.reduce((s, c) => s + c.sent, 0);
      const meta = l.totalMeta || l.items.reduce((s, c) => s + c.meta, 0);
      const saldo = Math.max(0, meta - sent);
      return `• ${l.name} [${l.model}]: ${sent}/${meta} (Saldo/余额: ${saldo})`;
    });

    const text = [
      '📊 COCKPIT LOGÍSTICO · ENTREGA DE MATERIAIS (物料配送看板)',
      `📅 Data (日期): ${formatBrDate(targetDate)} | 🕒 Turno (班次): ${shiftLabel}`,
      `👔 Coordenador (协调员): ${coordinator} | Líder (组长): ${leadership}`,
      `👷 Responsável (负责人): ${responsible}`,
      '',
      `📦 Movimentação do Dia (当日配送总量): ${totalPallets} paletes (托盘) | ${totalTrips} viagens (车次)`,
      ...(modelLines.length ? ['🚗 Volume por Modelo (各车型配送量):', ...modelLines] : ['🚗 Volume por Modelo (各车型配送量): Sem registros (无记录)']),
      '',
      ...(lotLines.length ? ['📋 Status dos Lotes Ativos (批次进度):', ...lotLines] : ['📋 Status dos Lotes Ativos (批次进度): Nenhum lote ativo (无进行中批次)'])
    ].join('\n');

    if ('value' in box) box.value = text;
    else box.textContent = text;
  }

  function renderAuditTable(allDayRecords) {
    const tbody = el('cockpitTableBody');
    if (!tbody) return;

    if (!allDayRecords.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum lançamento encontrado para os filtros selecionados.</td></tr>';
      return;
    }

    const sorted = allDayRecords.slice().sort((a, b) => String(b.DataHora || '').localeCompare(String(a.DataHora || '')));
    tbody.innerHTML = sorted.map((r) => {
      const isVoid = String(r.Status || '').toUpperCase() === 'ESTORNADO';
      return `<tr>
        <td>${escapeHtml(formatHour(r))}</td>
        <td>${escapeHtml(r.Turno || '')}</td>
        <td><strong>${escapeHtml(r.Nome_Lote || '')}</strong> · ${escapeHtml(r.Componente || '')} (${escapeHtml(normModel(r.Modelo_Base))})</td>
        <td><strong>${Number(r.Qtd_Enviada) || 0}</strong></td>
        <td>${escapeHtml(r.Motorista || '')} / ${escapeHtml(r.Frota || '')}</td>
        <td>${escapeHtml(r.Operador || '')}</td>
        <td><span class="status-tag ${isVoid ? 'void' : 'ok'}">${isVoid ? 'ESTORNADO' : 'ENTREGUE'}</span></td>
      </tr>`;
    }).join('');
  }

  function render() {
    bindEvents();
    const dateInput = el('cockpitDateFilter');
    if (dateInput && !dateInput.value) dateInput.value = todayStr();

    const catalog = catalogMap(latestContext);
    const dayRecords = filterRecordsList(false);
    const allDayRecords = filterRecordsList(true);
    const lots = buildLotStats(catalog);

    renderHeaderMeta(dayRecords, lots);
    renderKpis(dayRecords, lots);
    renderLotProgress(lots);
    renderModelVolume(dayRecords);
    renderDriverProductivity(dayRecords);
    renderBilingualSummary(dayRecords, lots);
    renderAuditTable(allDayRecords);

    if (el('cockpitImagePreviewCard') && !el('cockpitImagePreviewCard').hidden) {
      generateCockpitImage(false);
    }
  }

  function update(records = [], context = {}) {
    latestRecords = Array.isArray(records) ? records : [];
    latestContext = context || {};
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  return { update, render, generateImage: () => generateCockpitImage(true) };
})();

window.Cockpit = Cockpit;