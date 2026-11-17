/* ==========================================================================
   main.js — Lógica do Gerador de Escopo e Sintonia Sankhya
   Depende de js/data.js (catalogo, modulosDados, horasPorPack, infoGrupo,
   infoPack, MIGRACAO, sintoniaData).
   Seções:
     1. Utilitários
     2. Abas
     3. Montagem da tela (Escopo e Sintonia)
     4. Regra de horas (Simulador), escopo por CNPJ e participantes
     5. Estado da simulação (coletar / aplicar / comparar)
     6. Exportações (Word e HTML, com o mesmo modelo de documento)
     7. Pasta de simulações (File System Access API + IndexedDB)
     8. Salvar, abrir, comparar e importar versões
     9. Inicialização
   ========================================================================== */

const APP_ID = 'gerador-escopo-sankhya';
const FORMATO_ARQUIVO = 1;
const PASTA_SIMULACOES = 'simulacoes';
const SUPORTA_PASTA = 'showDirectoryPicker' in window;

/* ==========================================================================
   1. UTILITÁRIOS
   ========================================================================== */
function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function capitalizarFrase(texto) {
    if (!texto) return '';
    texto = texto.trim();
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "Sankhya Gestão" -> "SANKHYA-GESTAO" (nome seguro de pasta) */
function slug(texto) {
    return String(texto || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9.]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .toUpperCase()
        .slice(0, 60);
}

function nomePasta(cliente, proposta) {
    return `${slug(cliente) || 'SEM-CLIENTE'}_${slug(proposta) || 'SEM-PROPOSTA'}`;
}

function pad3(n) { return String(n).padStart(3, '0'); }

function carimboArquivo(data = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}_${p(data.getHours())}h${p(data.getMinutes())}`;
}

function formatarDataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function num(v) { return (parseFloat(v) || 0).toFixed(2); }

function resumir(texto, max = 60) {
    texto = String(texto || '').replace(/\s+/g, ' ').trim();
    return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
}

let toastTimer;
function toast(msg, erro = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('erro', erro);
    el.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visivel'), erro ? 6000 : 3500);
}

function baixarBlob(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function lerPreferencia(chave) { try { return localStorage.getItem(chave) || ''; } catch { return ''; } }
function gravarPreferencia(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento */ } }

/* ==========================================================================
   2. ABAS
   ========================================================================== */
function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === tabId));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.toggle('active', el.dataset.tab === tabId));
    if (tabId === 'tab-simulacoes') renderizarListaSimulacoes();
}

/* ==========================================================================
   3. MONTAGEM DA TELA
   As referências aos campos ficam em "refs" para não depender de seletores
   com nomes de pacotes (que têm barras, acentos etc.).
   ========================================================================== */
const refs = { cats: {}, sintonia: [], cnpjs: [] };
const ROTULO_REGRA = {
    pack: 'Consultoria de pack',
    ecossistema: 'Integração com o ecossistema',
    addon: 'Add-on (fora da regra)'
};

function fmtH(h, casas = 1) {
    const f = 10 ** casas;
    const v = Math.round((Number(h) || 0) * f + 1e-7) / f;   // arredonda como o Excel (1.394,95 → 1.395,0)
    return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function montarModulos() {
    const container = document.getElementById('modulos-container');
    let secaoAtual = null;

    for (const [categoria, packs] of Object.entries(modulosDados)) {
        const info = infoGrupo[categoria] || {};

        // Cabeçalho da seção do catálogo (Packs Sankhya, Apps Móveis, Parceiros)
        if (info.secao !== secaoAtual) {
            secaoAtual = info.secao;
            const secao = catalogo.find(s => s.secao === secaoAtual);
            const cab = document.createElement('div');
            cab.className = 'secao-catalogo';
            cab.dataset.secao = secaoAtual;
            cab.innerHTML = `<h3>${esc(secaoAtual)}</h3>${secao?.descricao ? `<p>${esc(secao.descricao)}</p>` : ''}`;
            container.appendChild(cab);
        }

        const box = document.createElement('div');
        box.className = 'modulo-box';
        box.dataset.secao = secaoAtual;
        const lic = info.licenciante;
        const ehParceiro = lic && lic !== SANKHYA;

        let html = `
            <h3><label class="cat-label"><input type="checkbox" class="cat-checkbox"> ${esc(categoria)}</label>
                ${info.selo ? `<span class="grupo-selo">${esc(info.selo)}</span>` : ''}
                <span class="grupo-regra regra-${info.regra}" title="Como as horas deste grupo entram no cálculo">${ROTULO_REGRA[info.regra] || ''}</span>
                <span class="grupo-resumo"></span></h3>
            ${info.nota ? `<p class="grupo-nota">${esc(info.nota)}</p>` : ''}
            ${info.incluiGrupo ? `<p class="grupo-nota">Ao marcar este grupo, o <strong>${esc(info.incluiGrupo)}</strong> entra junto com todos os subprocessos.</p>` : ''}
            ${info.horasGrupo ? `<p class="grupo-nota">Integração com o ERP Sankhya: +${fmtH(info.horasGrupo, 0)} h uma vez, com qualquer pack deste grupo.</p>` : ''}
            ${ehParceiro ? `<p class="grupo-licenciante">Licenciado por <strong>${esc(lic.nome)}</strong>${lic.razaoSocial ? ` (${esc(lic.razaoSocial)})` : ''}</p>` : ''}
            <div class="cat-content">`;

        if (info.tipo === 'usuarios') {
            html += htmlPlanilhaUsuarios(categoria, packs);
        } else for (const [packName, rotinas] of Object.entries(packs)) {
            html += htmlPack(categoria, packName, rotinas);
        }
        html += `<textarea placeholder="Observações específicas (Opcional)" aria-label="Observações de ${esc(categoria)}"></textarea></div>`;
        box.innerHTML = html;
        container.appendChild(box);

        const ref = {
            box,
            chk: box.querySelector('.cat-checkbox'),
            content: box.querySelector('.cat-content'),
            obs: box.querySelector('textarea'),
            resumo: box.querySelector('.grupo-resumo'),
            planilha: info.tipo === 'usuarios' ? box : null,
            packs: {}
        };
        box.querySelectorAll('.pack-container').forEach(pc => {
            const packName = pc.dataset.pack;
            const ip = infoPack[packName] || {};
            const hora = pc.querySelector('.input-hora-pack');
            if (hora) {
                hora.addEventListener('input', () => {
                    hora.classList.toggle('alterada', num(hora.value) !== num(horasPorPack[packName]));
                    calcularHoras();
                });
            }
            const subs = [...pc.querySelectorAll('.sub-checkbox')];
            subs.forEach(cb => cb.addEventListener('change', calcularHoras));
            const usuarios = pc.querySelector('.input-usuarios');
            if (usuarios) prepararCampoUsuarios(usuarios, box, categoria);
            pc.querySelectorAll('[data-marcar]').forEach(b => b.addEventListener('click', () => {
                subs.forEach(s => s.checked = b.dataset.marcar === 'todos');
                calcularHoras();
                agendarVerificacao();
            }));
            ref.packs[packName] = {
                hora, subs, usuarios,
                comMinutos: !!ip.comMinutos,
                minutos: ip.minutos || [],
                processos: ip.processos || [],
                ids: ip.ids || [],
                saida: pc.querySelector('.pack-horas-sel')
            };
        });
        ref.chk.addEventListener('change', () => {
            definirCategoriaAtiva(categoria, ref.chk.checked, true, true, true);
            calcularHoras();
        });
        refs.cats[categoria] = ref;
    }
}

function htmlPack(categoria, packName, rotinas) {
    const ip = infoPack[packName] || {};
    const busca = `${categoria} ${packName} ${ip.codigo || ''} ${rotinas.join(' ')}`.toLowerCase();
    let html = `
        <div class="pack-container" data-pack="${esc(packName)}" data-busca="${esc(busca)}">
            <div class="pack-title">
                <span>${esc(packName)}</span>
                ${ip.codigo ? `<span class="pack-codigo" title="Código do produto">Cód. ${esc(ip.codigo)}</span>` : ''}
                ${ip.novo ? '<span class="pack-novo">Novo</span>' : ''}`;

    if (ip.comMinutos) {
        // Pack com minutagem: as horas vêm dos subprocessos marcados
        html += `
                <span class="pack-est" title="Soma de todos os subprocessos do pack">Cheio: ${fmtH(horasPorPack[packName])} h</span>
                <span class="pack-horas-sel" aria-live="polite">0,0 h no escopo</span>
                <span class="pack-marcar">
                    <button type="button" class="link-btn" data-marcar="todos">todos</button> ·
                    <button type="button" class="link-btn" data-marcar="nenhum">nenhum</button>
                </span>
            </div>
            <div class="sub-items-wrapper">`;
        rotinas.forEach((sub, i) => {
            const min = ip.minutos[i];
            html += `
                <label class="sub-item-label">
                    <input type="checkbox" class="sub-checkbox" value="${esc(sub)}">
                    <span class="sub-texto">${esc(capitalizarFrase(sub))}</span>
                    <span class="sub-meta">${esc(processos[ip.processos[i]] || '')} · ${min} min</span>
                </label>`;
        });
    } else {
        // Pack sem minutagem: horas informadas no próprio pack
        const qtdHoras = (horasPorPack[packName] || 0).toFixed(2);
        html += `
                ${parseFloat(qtdHoras) > 0 ? `<span class="pack-est">Est: ${qtdHoras}h</span>` : '<span class="pack-sem-horas">Horas a definir</span>'}
                <span class="pack-hours">
                    <input type="number" step="0.01" min="0" class="input-hora-pack" value="${qtdHoras}" title="Horas deste pack" aria-label="Horas de ${esc(packName)}"> h
                </span>
            </div>
            <div class="sub-items-wrapper">`;
        if (!rotinas.length) {
            html += `
                <label class="sub-item-label">
                    <input type="checkbox" class="sub-checkbox" value="${esc(packName)}">
                    <span>Incluir este pack no escopo</span>
                </label>`;
        }
        rotinas.forEach(sub => {
            html += `
                <label class="sub-item-label">
                    <input type="checkbox" class="sub-checkbox" value="${esc(sub)}">
                    <span>${esc(capitalizarFrase(sub))}</span>
                </label>`;
        });
    }
    return html + `</div></div>`;
}

/* ---------- Planilha de usuários (Apps Móveis) ---------- */
function htmlPlanilhaUsuarios(categoria, packs) {
    let html = `
        <p class="planilha-ajuda">Informe a quantidade de usuários de cada solução. Soluções com quantidade maior que zero entram no escopo.
            Você pode colar uma coluna de números copiada do Excel.</p>
        <div class="planilha-wrap">
        <table class="planilha-usuarios">
            <thead><tr><th>Solução</th><th>Código</th><th class="num">Qtd. usuários</th><th class="num">Horas</th></tr></thead>
            <tbody>`;
    for (const packName of Object.keys(packs)) {
        const ip = infoPack[packName] || {};
        const horas = (horasPorPack[packName] || 0).toFixed(2);
        html += `
                <tr class="pack-container" data-pack="${esc(packName)}" data-busca="${esc(`${categoria} ${packName} ${ip.codigo || ''}`.toLowerCase())}">
                    <td>${esc(packName)} ${ip.novo ? '<span class="pack-novo">Novo</span>' : ''}</td>
                    <td>${ip.codigo ? esc(ip.codigo) : '<span class="text-muted">—</span>'}</td>
                    <td class="num"><input type="number" min="0" step="1" class="input-usuarios" inputmode="numeric" placeholder="0" aria-label="Usuários de ${esc(packName)}"></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="input-hora-pack" value="${horas}" aria-label="Horas de ${esc(packName)}"></td>
                </tr>`;
    }
    html += `
            </tbody>
            <tfoot><tr><td colspan="2">Total de usuários</td><td class="num total-usuarios">0</td><td class="num total-solucoes">0 soluções</td></tr></tfoot>
        </table>
        </div>`;
    return html;
}

function qtdUsuarios(pack) {
    return pack.usuarios ? Math.max(0, parseInt(pack.usuarios.value, 10) || 0) : 0;
}

function atualizarTotalUsuarios(box) {
    const campos = [...box.querySelectorAll('.input-usuarios')];
    const valores = campos.map(c => Math.max(0, parseInt(c.value, 10) || 0));
    const total = valores.reduce((a, b) => a + b, 0);
    const solucoes = valores.filter(v => v > 0).length;
    box.querySelector('.total-usuarios').textContent = total.toLocaleString('pt-BR');
    box.querySelector('.total-solucoes').textContent = `${solucoes} ${solucoes === 1 ? 'solução' : 'soluções'}`;
    campos.forEach((c, i) => c.closest('tr').classList.toggle('com-usuarios', valores[i] > 0));
}

function prepararCampoUsuarios(campo, box) {
    campo.addEventListener('input', () => { atualizarTotalUsuarios(box); calcularHoras(); });
    // Enter / setas para cima e para baixo mudam de linha, como numa planilha
    campo.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const campos = [...box.querySelectorAll('tr:not([hidden]) .input-usuarios')];
        const alvo = campos[campos.indexOf(campo) + (e.key === 'ArrowUp' ? -1 : 1)];
        if (alvo) { alvo.focus(); alvo.select(); }
    });
    // Colar uma coluna do Excel preenche as linhas seguintes
    campo.addEventListener('paste', e => {
        const texto = (e.clipboardData || window.clipboardData).getData('text');
        const linhas = texto.split(/\r?\n/).filter(l => l.trim() !== '');
        if (linhas.length < 2) return;
        e.preventDefault();
        const campos = [...box.querySelectorAll('tr:not([hidden]) .input-usuarios')];
        const inicio = campos.indexOf(campo);
        linhas.forEach((l, i) => {
            const c = campos[inicio + i];
            if (c) c.value = parseInt(l.split('\t').pop().replace(/\D/g, ''), 10) || '';
        });
        atualizarTotalUsuarios(box);
        calcularHoras();
        agendarVerificacao();
    });
}

/** Filtra grupos e packs pelo texto digitado (nome, código ou subprocesso). */
function filtrarPacks() {
    const termo = document.getElementById('busca-pack').value.trim().toLowerCase();
    let visiveis = 0;
    document.querySelectorAll('#modulos-container .modulo-box').forEach(box => {
        let algum = false;
        box.querySelectorAll('.pack-container').forEach(pc => {
            const ok = !termo || pc.dataset.busca.includes(termo);
            pc.hidden = !ok;
            if (ok) { algum = true; visiveis++; }
        });
        box.hidden = !algum;
    });
    document.querySelectorAll('#modulos-container .secao-catalogo').forEach(cab => {
        cab.hidden = !document.querySelector(`#modulos-container .modulo-box[data-secao="${CSS.escape(cab.dataset.secao)}"]:not([hidden])`);
    });
    const total = Object.keys(horasPorPack).length;
    document.getElementById('busca-resultado').textContent = termo
        ? (visiveis ? `${visiveis} de ${total} packs` : 'Nenhum pack encontrado. Tente outro nome, código ou subprocesso.')
        : `${total} packs em ${Object.keys(modulosDados).length} grupos`;
}

/**
 * Ativa/desativa um grupo.
 * marcarTudo: ao ativar um grupo de oferta (regra "pack"), entra o pacote cheio
 * (todos os subprocessos marcados), como no Simulador; o EV desmarca o que fica fora.
 */
function definirCategoriaAtiva(categoria, ativa, limparAoDesativar, marcarTudo = false, avisar = false) {
    const ref = refs.cats[categoria];
    const info = infoGrupo[categoria] || {};
    const estavaAtiva = ref.chk.checked && ref.content.classList.contains('ativo');
    ref.chk.checked = ativa;
    ref.content.classList.toggle('ativo', ativa);

    if (ativa) {
        if (marcarTudo && !estavaAtiva && info.regra === 'pack') {
            Object.values(ref.packs).forEach(p => { if (p.comMinutos) p.subs.forEach(s => s.checked = true); });
        }
        // O Completo leva o Essencial inteiro
        if (info.incluiGrupo && refs.cats[info.incluiGrupo] && !refs.cats[info.incluiGrupo].chk.checked) {
            definirCategoriaAtiva(info.incluiGrupo, true, false, marcarTudo);
        }
        return;
    }

    if (limparAoDesativar) {
        Object.values(ref.packs).forEach(p => {
            p.subs.forEach(s => s.checked = false);
            if (p.usuarios) p.usuarios.value = '';
        });
        ref.obs.value = '';
        if (ref.planilha) atualizarTotalUsuarios(ref.planilha);
    }
    // Sem o Essencial não há Completo
    for (const [outro, infoOutro] of Object.entries(infoGrupo)) {
        if (infoOutro.incluiGrupo === categoria && refs.cats[outro]?.chk.checked) {
            definirCategoriaAtiva(outro, false, limparAoDesativar);
            if (avisar) toast(`${outro} também foi desmarcado: ele inclui o ${categoria}.`);
        }
    }
}

function montarSintonia() {
    let html = `
        <table>
            <thead>
                <tr>
                    <th style="width: 15%">Categoria</th>
                    <th style="width: 40%">Questionamento / Campo de Dados</th>
                    <th style="width: 45%">Resposta / Observação</th>
                </tr>
            </thead>
            <tbody>`;

    let secaoAtual = '';
    const perguntas = [];
    sintoniaData.forEach(item => {
        if (item.type === 'header') {
            secaoAtual = item.title;
            html += `<tr class="sint-header"><td colspan="3">${esc(item.title)}</td></tr>`;
        } else {
            // Chave estável: seção + categoria + pergunta (não depende da posição)
            perguntas.push({ chave: `${secaoAtual}|${item.categoria}|${item.questionamento}`, item });
            html += `<tr>
                <td class="sint-cat">${esc(item.categoria)}</td>
                <td class="sint-q">${esc(item.questionamento)}</td>
                <td><textarea class="sint-resp" rows="2" aria-label="${esc(item.questionamento)}"></textarea></td>
            </tr>`;
        }
    });
    html += `</tbody></table>`;

    const container = document.getElementById('sintonia-container');
    container.innerHTML = html;
    container.querySelectorAll('.sint-resp').forEach((el, i) => refs.sintonia.push({ ...perguntas[i], el }));
}

/* ==========================================================================
   4. REGRA DE HORAS, ESCOPO POR CNPJ E PARTICIPANTES
   Mesma regra da aba "Simulador" da planilha de minutagem (regra do Ploomes).
   ========================================================================== */
const PROCESSO_OUTROS = 'OUTROS';
function nomeProcesso(codigo) { return codigo === PROCESSO_OUTROS ? 'Outros packs do escopo' : (processos[codigo] || codigo); }
function valorCampo(id) { return parseFloat(String(document.getElementById(id).value).replace(',', '.')) || 0; }

function packIncluido(pack) {
    return pack.subs.some(s => s.checked) || qtdUsuarios(pack) > 0;
}

/** Calcula todos os itens da regra a partir da tela. */
function calcularRegra() {
    const r = {
        item1: 0, item1Cheio: 0, item6: 0, addons: 0,
        horasProcesso: {},          // horas no escopo por processo (base do rollout por CNPJ)
        procSubs: {},               // processo -> { total, noEscopo, fora: [subprocessos retirados], dentro: [...] }
        addonsLista: [], ofertas: [], especialistas: []
    };

    for (const [categoria, ref] of Object.entries(refs.cats)) {
        if (!ref.chk.checked) continue;
        const info = infoGrupo[categoria];
        let grupoTemPack = false;
        if (info.regra === 'pack') (info.incluiGrupo || categoria === 'Sankhya OM Essencial' ? r.ofertas : r.especialistas).push(categoria);

        for (const [packName, pack] of Object.entries(ref.packs)) {
            if (info.regra === 'pack' && pack.comMinutos) {
                pack.subs.forEach((s, i) => {
                    const proc = pack.processos[i], min = pack.minutos[i];
                    // Subprocessos compartilhados entre dois packs contam uma vez (o minuto já foi rateado)
                    const p = r.procSubs[proc] = r.procSubs[proc] || { dentro: new Map(), fora: new Map() };
                    r.item1Cheio += min / 60;
                    if (s.checked) {
                        p.dentro.set(pack.ids[i], s.value);
                        r.item1 += min / 60;
                        r.horasProcesso[proc] = (r.horasProcesso[proc] || 0) + min / 60;
                    } else {
                        p.fora.set(pack.ids[i], s.value);
                    }
                });
                continue;
            }
            if (!packIncluido(pack)) continue;
            grupoTemPack = true;
            const horas = pack.hora ? (parseFloat(pack.hora.value) || 0) : 0;
            if (info.regra === 'pack') {
                r.item1 += horas; r.item1Cheio += horas;
                r.horasProcesso[PROCESSO_OUTROS] = (r.horasProcesso[PROCESSO_OUTROS] || 0) + horas;
            } else if (info.regra === 'ecossistema') {
                r.item6 += horas;
            } else {
                r.addons += horas;
                r.addonsLista.push(packName);
            }
        }
        if (info.regra === 'ecossistema' && grupoTemPack) r.item6 += info.horasGrupo || 0;
    }

    // Estrutura: matrizes, filiais e segmentos (manuais ou pelo escopo por CNPJ)
    r.segmentos = Math.max(1, valorCampo('qtd-segmentos'));
    r.cnpj = calcularCnpjs(r.horasProcesso);
    if (r.cnpj.emUso) {
        r.matrizes = r.cnpj.matrizes; r.filiais = r.cnpj.filiais;
    } else {
        r.matrizes = Math.max(1, valorCampo('qtd-matrizes')); r.filiais = Math.max(0, valorCampo('qtd-filiais'));
    }

    const temEscopo = r.ofertas.length + r.especialistas.length > 0;
    r.item2 = temEscopo ? REGRA_HORAS.importacaoPadrao + (document.getElementById('regra-import-adic').checked ? REGRA_HORAS.importacaoAdicional : 0) : 0;

    const rollout = (base, mat, fil, seg) =>
        Math.max(0, (mat - 1) * base * REGRA_HORAS.percentualMatrizAdicional) +
        Math.max(0, fil * base * REGRA_HORAS.percentualFilial) +
        Math.max(0, (seg - 1) * base * REGRA_HORAS.percentualSegmentoAdicional);
    const segmentos = Math.max(0, (r.segmentos - 1) * r.item1 * REGRA_HORAS.percentualSegmentoAdicional);
    r.item3 = Math.round(r.cnpj.emUso ? r.cnpj.rollout + segmentos : rollout(r.item1, r.matrizes, r.filiais, r.segmentos));

    r.item4 = Math.max(0, valorCampo('regra-customizacao'));
    r.item5 = Math.max(0, valorCampo('regra-personalizacao'));
    r.totalAjustado = r.item1 + r.item2 + r.item3 + r.item4 + r.item5 + r.item6;

    r.cnabCobranca = Math.max(0, Math.floor(valorCampo('regra-cnab-cobranca')));
    r.cnabPagamento = Math.max(0, Math.floor(valorCampo('regra-cnab-pagamento')));
    r.cnab = r.cnabCobranca * REGRA_HORAS.cnabCobrancaPorBanco + r.cnabPagamento * REGRA_HORAS.cnabPagamentoPorBanco;
    r.addonsCnab = r.addons + r.cnab;

    r.ajustePct = valorCampo('regra-ajuste-pct') / 100;
    r.horasAdicionais = valorCampo('regra-horas-adic');
    r.justificativa = document.getElementById('regra-justificativa').value.trim();
    r.desejado = Math.max(0, Math.ceil((r.totalAjustado + r.addonsCnab) * (1 + r.ajustePct) + r.horasAdicionais - 1e-9));

    // Total tabela do Ploomes: pacote cheio, sem retiradas, sem add-ons
    r.tabela = r.item1Cheio + r.item2 + Math.round(rollout(r.item1Cheio, r.matrizes, r.filiais, r.segmentos)) + r.item4 + r.item5 + r.item6;

    // Contagens para os textos
    for (const p of Object.values(r.procSubs)) {
        p.dentro.forEach((t, id) => p.fora.delete(id));
        p.dentro = [...p.dentro.values()]; p.fora = [...p.fora.values()];
        p.noEscopo = p.dentro.length; p.total = p.noEscopo + p.fora.length;
    }
    r.processosNoEscopo = Object.values(r.procSubs).filter(p => p.noEscopo > 0).length + (r.horasProcesso[PROCESSO_OUTROS] ? 1 : 0);
    r.subprocessosNoEscopo = Object.values(r.procSubs).reduce((t, p) => t + p.noEscopo, 0);
    r.processosRetirados = Object.keys(r.procSubs).filter(c => r.procSubs[c].noEscopo === 0);
    r.subprocessosRetirados = Object.values(r.procSubs).filter(p => p.noEscopo > 0).reduce((t, p) => t + p.fora.length, 0);
    r.oferta = r.ofertas.includes('Sankhya OM Completo') ? 'Completo' : r.ofertas.includes('Sankhya OM Essencial') ? 'Essencial' : 'Nenhum';
    return r;
}

/* ---------- Escopo por CNPJ ---------- */

/** Valida CNPJ numérico ou alfanumérico (Receita Federal, a partir de 07/2026). */
function cnpjValido(valor) {
    const c = String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
    const dv = (base) => {
        let soma = 0, peso = 2;
        for (let i = base.length - 1; i >= 0; i--) {
            soma += (base.charCodeAt(i) - 48) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    const d1 = dv(c.slice(0, 12));
    const d2 = dv(c.slice(0, 12) + d1);
    return c.slice(12) === `${d1}${d2}`;
}

function formatarCnpj(valor) {
    const c = String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
    return c.replace(/^(.{2})(.{0,3})?(.{0,3})?(.{0,4})?(.{0,2})?$/, (m, a, b, c3, d, e) =>
        [a, b && `.${b}`, c3 && `.${c3}`, d && `/${d}`, e && `-${e}`].filter(Boolean).join(''));
}

function addCnpj(dados = {}) {
    const lista = document.getElementById('cnpj-lista');
    const card = document.createElement('div');
    card.className = 'cnpj-card';
    const tipos = Object.keys(TIPOS_CNPJ);
    const tipoInicial = dados.tipo ?? (refs.cnpjs.length === 0 ? tipos[0] : '');
    card.innerHTML = `
        <div class="cnpj-linha">
            <label>CNPJ <input type="text" class="cnpj-num" maxlength="18" placeholder="00.000.000/0000-00" value="${esc(formatarCnpj(dados.cnpj))}" spellcheck="false"></label>
            <label class="cnpj-empresa">Empresa <input type="text" class="cnpj-nome" placeholder="Razão social ou nome" value="${esc(dados.empresa)}"></label>
            <label>Tipo
                <select class="cnpj-tipo">
                    <option value="">Selecione</option>
                    ${tipos.map(t => `<option ${t === tipoInicial ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                </select>
            </label>
            <div class="cnpj-num-info"><span>% de rollout</span><strong class="cnpj-pct">—</strong></div>
            <div class="cnpj-num-info"><span>Horas dos processos</span><strong class="cnpj-horas">—</strong></div>
            <div class="cnpj-num-info"><span>Horas de rollout</span><strong class="cnpj-rollout">—</strong></div>
            <button type="button" class="btn btn-remove" aria-label="Remover CNPJ">X</button>
        </div>
        <details class="cnpj-processos">
            <summary>Processos que este CNPJ usa: <span class="cnpj-proc-resumo"></span></summary>
            <div class="cnpj-proc-lista"></div>
        </details>`;
    const ref = { el: card, foraDoEscopo: new Set(dados.foraDoEscopo || []), chaveProcessos: '' };
    const campoCnpj = card.querySelector('.cnpj-num');
    campoCnpj.addEventListener('input', () => {
        const pos = campoCnpj.value.length;
        campoCnpj.value = formatarCnpj(campoCnpj.value);
        if (pos >= campoCnpj.value.length) campoCnpj.setSelectionRange(campoCnpj.value.length, campoCnpj.value.length);
        calcularHoras();
    });
    card.querySelector('.cnpj-tipo').addEventListener('change', calcularHoras);
    card.querySelector('.cnpj-nome').addEventListener('input', calcularHoras);
    card.querySelector('.btn-remove').addEventListener('click', () => {
        refs.cnpjs.splice(refs.cnpjs.indexOf(ref), 1);
        card.remove();
        calcularHoras();
        agendarVerificacao();
    });
    refs.cnpjs.push(ref);
    lista.appendChild(card);
    return ref;
}

function addCnpjClique() {
    if (!document.getElementById('cnpj-ativo').checked) document.getElementById('cnpj-ativo').checked = true;
    alternarEscopoCnpj();
    const ref = addCnpj();
    ref.el.querySelector('.cnpj-num').focus();
    calcularHoras();
    agendarVerificacao();
}

function alternarEscopoCnpj() {
    const ativo = document.getElementById('cnpj-ativo').checked;
    document.getElementById('cnpj-painel').hidden = !ativo;
    if (ativo && !refs.cnpjs.length) addCnpj();
    calcularHoras();
}

/** Atualiza a lista de processos de cada CNPJ e calcula o rollout proporcional. */
function calcularCnpjs(horasProcesso) {
    const ativo = document.getElementById('cnpj-ativo').checked;
    const res = { ativo, emUso: false, rollout: 0, matrizes: 1, filiais: 0, linhas: [], alerta: '' };
    const procs = Object.keys(horasProcesso).filter(c => horasProcesso[c] > 0);
    const chave = procs.join('|');

    refs.cnpjs.forEach(ref => {
        const card = ref.el;
        // Processos do escopo atual (re-renderiza só quando mudam)
        if (ref.chaveProcessos !== chave) {
            ref.chaveProcessos = chave;
            const lista = card.querySelector('.cnpj-proc-lista');
            lista.innerHTML = procs.length
                ? procs.map(c => `<label class="cnpj-proc"><input type="checkbox" value="${esc(c)}" ${ref.foraDoEscopo.has(c) ? '' : 'checked'}> ${esc(nomeProcesso(c))}</label>`).join('')
                : '<p class="text-muted">Marque os módulos do escopo para listar os processos.</p>';
            lista.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
                if (cb.checked) ref.foraDoEscopo.delete(cb.value); else ref.foraDoEscopo.add(cb.value);
                calcularHoras();
                agendarVerificacao();
            }));
        }
        const cnpj = card.querySelector('.cnpj-num').value.trim();
        const empresa = card.querySelector('.cnpj-nome').value.trim();
        const tipo = card.querySelector('.cnpj-tipo').value;
        const pct = tipo ? TIPOS_CNPJ[tipo] : null;
        const usa = procs.filter(c => !ref.foraDoEscopo.has(c));
        const horasProc = usa.reduce((t, c) => t + horasProcesso[c], 0);
        const rollout = pct == null ? 0 : horasProc * pct;
        const naoUsa = procs.filter(c => ref.foraDoEscopo.has(c)).map(nomeProcesso);
        const invalido = cnpj && !cnpjValido(cnpj);

        card.querySelector('.cnpj-num').classList.toggle('invalido', !!invalido);
        card.querySelector('.cnpj-num').title = invalido ? 'CNPJ com dígito verificador inválido' : '';
        card.querySelector('.cnpj-pct').textContent = pct == null ? '—' : `${fmtH(pct * 100, 1)}%`;
        card.querySelector('.cnpj-horas').textContent = `${fmtH(horasProc)} h`;
        card.querySelector('.cnpj-rollout').textContent = `${fmtH(rollout)} h`;
        card.querySelector('.cnpj-proc-resumo').textContent = procs.length
            ? (!naoUsa.length ? `todos os ${procs.length}`
                : usa.length <= naoUsa.length ? `${usa.length} de ${procs.length} (${usa.map(nomeProcesso).join(', ') || 'nenhum'})`
                : `${usa.length} de ${procs.length} (não usa: ${naoUsa.join(', ')})`)
            : '—';

        if (cnpj || empresa) res.linhas.push({ cnpj, empresa, tipo, pct, horasProc, rollout, naoUsa, invalido });
    });

    if (!ativo) return res;
    const linhas = res.linhas;
    const principais = linhas.filter(l => l.tipo === Object.keys(TIPOS_CNPJ)[0]).length;
    if (!linhas.length) res.alerta = 'Nenhum CNPJ preenchido: o item 3 segue as matrizes e filiais informadas acima.';
    else if (principais !== 1) res.alerta = 'Marque exatamente 1 CNPJ como Principal (já incluso).';
    else if (linhas.some(l => !l.tipo)) res.alerta = 'Há CNPJ sem tipo.';
    else if (linhas.some(l => l.invalido)) res.alerta = 'Há CNPJ com dígito verificador inválido (o cálculo continua).';

    res.emUso = linhas.length > 0;
    res.rollout = linhas.reduce((t, l) => t + l.rollout, 0);
    res.matrizes = Math.max(1, linhas.filter(l => l.tipo && l.tipo !== 'Filial').length);
    res.filiais = linhas.filter(l => l.tipo === 'Filial').length;
    return res;
}

function coletarCnpjs() {
    return refs.cnpjs.map(ref => ({
        cnpj: ref.el.querySelector('.cnpj-num').value.trim(),
        empresa: ref.el.querySelector('.cnpj-nome').value.trim(),
        tipo: ref.el.querySelector('.cnpj-tipo').value,
        foraDoEscopo: [...ref.foraDoEscopo]
    })).filter(c => c.cnpj || c.empresa || c.tipo);
}

/* ---------- Atualização da tela ---------- */
function calcularHoras() {
    // Horas por pack e resumo por grupo
    for (const [categoria, ref] of Object.entries(refs.cats)) {
        let marcados = 0, total = 0, minutos = 0;
        for (const pack of Object.values(ref.packs)) {
            if (!pack.comMinutos) continue;
            let minPack = 0;
            pack.subs.forEach((s, i) => { total++; if (s.checked) { marcados++; minPack += pack.minutos[i]; } });
            minutos += minPack;
            if (pack.saida) pack.saida.textContent = `${fmtH(minPack / 60)} h no escopo`;
        }
        ref.resumo.textContent = total && ref.chk.checked ? `${marcados} de ${total} subprocessos · ${fmtH(minutos / 60)} h` : '';
    }

    const r = calcularRegra();
    ultimaRegra = r;

    // Estrutura: com escopo por CNPJ, matrizes e filiais vêm da lista
    const mat = document.getElementById('qtd-matrizes'), fil = document.getElementById('qtd-filiais');
    mat.disabled = fil.disabled = r.cnpj.emUso;
    if (r.cnpj.emUso) { mat.value = r.cnpj.matrizes; fil.value = r.cnpj.filiais; }
    document.getElementById('nota-estrutura').hidden = !r.cnpj.emUso;
    const alerta = document.getElementById('cnpj-alerta');
    alerta.textContent = r.cnpj.alerta || (r.cnpj.emUso ? `Em uso: item 3 calculado por CNPJ (${r.cnpj.linhas.length} CNPJ${r.cnpj.linhas.length > 1 ? 's' : ''}, rollout de ${fmtH(r.cnpj.rollout)} h).` : '');
    alerta.classList.toggle('erro', !!r.cnpj.alerta && r.cnpj.emUso);

    // Composição
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('reg-1', fmtH(r.item1));
    set('reg-2', fmtH(r.item2));
    set('reg-3', fmtH(r.item3));
    set('reg-3-det', r.cnpj.emUso ? `rollout por CNPJ + ${fmtH(r.segmentos, 0)} segmento(s)` : `${fmtH(r.matrizes, 0)} matriz(es), ${fmtH(r.filiais, 0)} filial(is), ${fmtH(r.segmentos, 0)} segmento(s)`);
    set('reg-4', fmtH(r.item4));
    set('reg-5', fmtH(r.item5));
    set('reg-6', fmtH(r.item6));
    set('reg-total-ajustado', fmtH(r.totalAjustado));
    set('reg-addons', fmtH(r.addonsCnab));
    set('reg-addons-det', [r.addons ? `add-ons ${fmtH(r.addons)} h` : '', r.cnab ? `CNAB ${fmtH(r.cnab, 0)} h` : ''].filter(Boolean).join(' + ') || 'nenhum');
    set('reg-ajuste', [r.ajustePct ? `${fmtH(r.ajustePct * 100, 1)}%` : '', r.horasAdicionais ? `${r.horasAdicionais > 0 ? '+' : ''}${fmtH(r.horasAdicionais)} h` : ''].filter(Boolean).join(' e ') || '—');
    set('reg-desejado', `${r.desejado.toLocaleString('pt-BR')} h`);
    set('reg-tabela', `${fmtH(r.tabela, 0)} h`);
    const dif = r.desejado - Math.round(r.tabela);
    set('reg-diferenca', `${dif > 0 ? '+' : ''}${dif.toLocaleString('pt-BR')} h`);
    set('reg-contagem', `${r.processosNoEscopo} processo(s) · ${r.subprocessosNoEscopo} subprocesso(s) no escopo · ${r.subprocessosRetirados + Object.values(r.procSubs).filter(p => p.noEscopo === 0).reduce((t, p) => t + p.total, 0)} retirado(s)`);

    document.getElementById('horas-calculadas').value = r.desejado.toFixed(2);
    document.getElementById('horas').value = r.desejado.toFixed(2);

    if (document.getElementById('ploomes-textos').open) atualizarTextosPloomes();
}
let ultimaRegra = null;

/* ---------- Textos para o Ploomes (campos do EIP) ---------- */
function textosPloomes(r = ultimaRegra || calcularRegra()) {
    const h = x => `${fmtH(x)} h`;
    const int = x => Math.round(x).toLocaleString('pt-BR');
    const of = r.oferta;
    const dif = r.desejado - r.tabela;   // como na planilha: tabela sem arredondar
    const procsFora = r.processosRetirados.map(nomeProcesso);
    const ret = procsFora.length > 0 || r.subprocessosRetirados > 0;
    const aj = r.ajustePct !== 0 || r.horasAdicionais !== 0;

    const motivo = [
        `Total de horas ajustado de ${int(r.tabela)} h (tabela do Ploomes, pacote ${of} cheio) para ${int(r.desejado)} h (${dif > 0 ? '+' : ''}${int(dif)} h).`,
        '',
        ret ? `Motivo: retirada de escopo de entrega do pacote ${of} para comportar a expectativa do cliente perante o projeto.`
            : `Motivo: sem retirada de escopo do pacote ${of}.`,
        procsFora.length ? `• Processos retirados por inteiro: ${procsFora.join(', ')}.` : null,
        r.subprocessosRetirados ? `• ${r.subprocessosRetirados} subprocesso(s) retirado(s) de processos mantidos (listados no detalhamento de escopo).` : null,
        r.cnab ? `• Layouts CNAB (remessa e retorno): ${r.cnabCobranca} banco(s) de cobrança × ${REGRA_HORAS.cnabCobrancaPorBanco} h + ${r.cnabPagamento} banco(s) de pagamento × ${REGRA_HORAS.cnabPagamentoPorBanco} h = ${h(r.cnab)}.` : null,
        r.addons ? `• Add-ons incluídos: ${h(r.addons)}.` : null,
        aj ? `• Ajuste do EV: ${[r.ajustePct ? `${fmtH(r.ajustePct * 100, 0)}%` : '', r.horasAdicionais ? `${int(r.horasAdicionais)} h` : ''].filter(Boolean).join(' e ')}${r.justificativa ? ` — ${r.justificativa}` : ''}.` : null,
        '',
        `Composição das horas desejadas (estrutura: ${r.matrizes} matriz(es), ${r.filiais} filial(is), ${r.segmentos} segmento(s)):`,
        `• Consultoria de pack do escopo mantido: ${h(r.item1)}`,
        `• Importação de dados: ${h(r.item2)}`,
        `• Matrizes, filiais e segmentos: ${h(r.item3)}${r.cnpj.emUso ? ` — rollout proporcional ao escopo de cada um dos ${r.cnpj.linhas.length} CNPJs` : ''}`,
        `• Customização: ${h(r.item4)}`,
        `• Personalização: ${h(r.item5)}`,
        `• Integração com o ecossistema: ${h(r.item6)}`,
        r.cnab ? `• Layouts CNAB: ${h(r.cnab)}` : null,
        r.addons ? `• Add-ons: ${h(r.addons)}` : null,
        `= ${int(r.desejado)} h`
    ].filter(l => l !== null).join('\n');

    const cliente = document.getElementById('cliente').value.trim();
    const procsOrdem = Object.keys(processos).filter(c => r.procSubs[c]);
    const inc = procsOrdem.filter(c => r.procSubs[c].noEscopo > 0).map(c => `• ${nomeProcesso(c)} — ${r.procSubs[c].noEscopo} subprocesso(s)`);
    const ads = r.addonsLista.map(n => `• ${n} (add-on)`);
    const foraProc = procsOrdem.filter(c => r.procSubs[c].noEscopo === 0).map(c => `• ${nomeProcesso(c)} (processo inteiro)`);
    const foraSub = procsOrdem.filter(c => r.procSubs[c].noEscopo > 0).flatMap(c => r.procSubs[c].fora.map(s => `• ${nomeProcesso(c)}: ${s}`));
    const fazer = procsOrdem.flatMap(c => r.procSubs[c].dentro.map(s => `• ${nomeProcesso(c)}: ${s}`));
    const fora = [...foraProc, ...foraSub];

    const detalhamento = [
        `ESCOPO DO PROJETO — SANKHYA OM ${of.toUpperCase()}${r.especialistas.length ? ` + ESPECIALISTAS: ${r.especialistas.map(g => infoGrupo[g].rotuloPloomes).join(', ').toUpperCase()}` : ''}`,
        cliente ? `Cliente: ${cliente}` : null,
        `Total de horas: ${int(r.desejado)} h`,
        '',
        `ESCOPO QUE FICA (${r.subprocessosNoEscopo} subprocessos em ${r.processosNoEscopo} itens)`,
        ...inc, ...ads,
        r.cnab ? `• Layouts CNAB (remessa e retorno): ${r.cnabCobranca} banco(s) de cobrança e ${r.cnabPagamento} banco(s) de pagamento` : null,
        '',
        'ESCOPO QUE FICA FORA',
        ...(fora.length ? fora : [`• Nenhum item do pacote ${of} foi retirado.`]),
        '• Personalizações, integrações e desenvolvimentos específicos não descritos acima.',
        r.cnab ? null : '• Layouts CNAB de remessa e retorno bancário (não contratados).',
        '• Especialistas e add-ons não contratados nesta proposta.',
        '',
        ...(r.cnpj.emUso ? ['ESCOPO POR CNPJ', ...r.cnpj.linhas.map(l => `• ${[l.cnpj, l.empresa].filter(Boolean).join(' ')} (${l.tipo || 'sem tipo'}) — não usa: ${l.naoUsa.join(', ') || '—'}`), ''] : []),
        'SUBPROCESSOS QUE PRECISAM SER FEITOS',
        ...fazer
    ].filter(l => l !== null).join('\n');

    return { motivo, detalhamento };
}

function atualizarTextosPloomes() {
    const t = textosPloomes();
    document.getElementById('ploomes-motivo').value = t.motivo;
    document.getElementById('ploomes-detalhamento').value = t.detalhamento;
}

function copiarTextoPloomes(qual) {
    const texto = textosPloomes()[qual];
    const fallback = () => {
        const area = Object.assign(document.createElement('textarea'), { value: texto });
        document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    };
    (navigator.clipboard ? navigator.clipboard.writeText(texto).catch(fallback) : Promise.resolve(fallback()))
        .then(() => toast(qual === 'motivo' ? 'Texto "Motivo para ajuste de horas" copiado.' : 'Texto "Detalhamento de escopo" copiado.'));
}

function addParticipante(dados = {}) {
    const tbody = document.querySelector('#tabela-participantes tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="part-nome" value="${esc(dados.nome)}" aria-label="Nome"></td>
        <td><input type="text" class="part-cargo" value="${esc(dados.cargo)}" aria-label="Cargo"></td>
        <td><input type="text" class="part-empresa" value="${esc(dados.empresa)}" aria-label="Empresa"></td>
        <td class="center"><input type="checkbox" class="part-assina" ${dados.assina ? 'checked' : ''} aria-label="Assina"></td>
        <td class="center"><button class="btn btn-remove" type="button" aria-label="Remover participante">X</button></td>`;
    tr.querySelector('.btn-remove').addEventListener('click', () => { tr.remove(); agendarVerificacao(); });
    tbody.appendChild(tr);
}

/* ==========================================================================
   5. ESTADO DA SIMULAÇÃO
   ========================================================================== */
const CAMPOS_REGRA = {
    customizacao: 'regra-customizacao',
    personalizacao: 'regra-personalizacao',
    cnabCobranca: 'regra-cnab-cobranca',
    cnabPagamento: 'regra-cnab-pagamento',
    ajustePct: 'regra-ajuste-pct',
    horasAdicionais: 'regra-horas-adic',
    justificativa: 'regra-justificativa'
};

function estadoPadrao() {
    return {
        versaoCatalogo: VERSAO_CATALOGO,
        identificacao: { cliente: '', proposta: '', dataDoc: '' },
        quantidades: { matrizes: '1', filiais: '0', segmentos: '1' },
        participantes: [{ nome: 'Cláudio Nunes', cargo: 'Diretor de Serviços', empresa: 'Sankhya', assina: true }],
        modulos: {},
        regra: { importacaoAdicional: false, customizacao: '0', personalizacao: '0', cnabCobranca: '0', cnabPagamento: '0', ajustePct: '0', horasAdicionais: '0', justificativa: '' },
        cnpj: { ativo: false, lista: [] },
        naoEscopo: '',
        horasCalculadas: '0.00',
        horasFinal: '0.00',
        sintonia: {}
    };
}

function coletarEstado() {
    const val = id => document.getElementById(id).value;
    const estado = {
        versaoCatalogo: VERSAO_CATALOGO,
        identificacao: { cliente: val('cliente').trim(), proposta: val('proposta').trim(), dataDoc: val('data-doc') },
        quantidades: { matrizes: val('qtd-matrizes'), filiais: val('qtd-filiais'), segmentos: val('qtd-segmentos') },
        participantes: [...document.querySelectorAll('#tabela-participantes tbody tr')].map(tr => ({
            nome: tr.querySelector('.part-nome').value,
            cargo: tr.querySelector('.part-cargo').value,
            empresa: tr.querySelector('.part-empresa').value,
            assina: tr.querySelector('.part-assina').checked
        })),
        modulos: {},
        regra: { importacaoAdicional: document.getElementById('regra-import-adic').checked },
        cnpj: { ativo: document.getElementById('cnpj-ativo').checked, lista: coletarCnpjs() },
        naoEscopo: val('nao-escopo-texto'),
        horasCalculadas: val('horas-calculadas'),
        horasFinal: val('horas'),
        sintonia: {}
    };
    for (const [chave, id] of Object.entries(CAMPOS_REGRA)) estado.regra[chave] = val(id);

    for (const [categoria, ref] of Object.entries(refs.cats)) {
        if (!ref.chk.checked) continue;
        const cat = { obs: ref.obs.value, packs: {} };
        for (const [packName, pack] of Object.entries(ref.packs)) {
            const itens = pack.subs.filter(s => s.checked).map(s => s.value);
            const usuarios = qtdUsuarios(pack);
            const horas = pack.comMinutos
                ? num(pack.subs.reduce((t, s, i) => t + (s.checked ? pack.minutos[i] : 0), 0) / 60)
                : num(pack.hora ? pack.hora.value : 0);
            const horasAlteradas = !pack.comMinutos && horas !== num(horasPorPack[packName]);
            if (itens.length || horasAlteradas || usuarios) {
                cat.packs[packName] = { horas, itens };
                if (pack.usuarios) cat.packs[packName].usuarios = usuarios;
            }
        }
        estado.modulos[categoria] = cat;
    }

    refs.sintonia.forEach(s => { if (s.el.value.trim()) estado.sintonia[s.chave] = s.el.value; });
    return estado;
}

/**
 * Converte simulações salvas com catálogos anteriores:
 * cada pack vai para o grupo em que está hoje e, como as rotinas antigas foram
 * substituídas pelos subprocessos da planilha, o pack entra com todos os subprocessos.
 */
function migrarEstado(estado) {
    if (!estado || !estado.modulos || (estado.versaoCatalogo || 1) >= VERSAO_CATALOGO) return estado;
    const modulos = {};
    const garantir = g => (modulos[g] = modulos[g] || { obs: '', packs: {} });
    for (const [categoria, dados] of Object.entries(estado.modulos)) {
        const grupoNovo = MIGRACAO.categorias[categoria] || categoria;
        if (dados.obs) {
            const g = garantir(grupoNovo);
            g.obs = g.obs ? `${g.obs}\n${dados.obs}` : dados.obs;
        }
        for (const [pack, dp] of Object.entries(dados.packs || {})) {
            const nome = MIGRACAO.packs[pack] || pack;
            const grupo = infoPack[nome]?.grupo || grupoNovo;
            const selecionado = (dp.itens || []).length > 0 || (dp.usuarios || 0) > 0;
            garantir(grupo).packs[nome] = { horas: dp.horas, itens: [], usuarios: dp.usuarios || 0, selecionarTodos: selecionado };
        }
    }
    // Quem tem o Completo tem o Essencial
    for (const g of Object.keys(modulos)) if (infoGrupo[g]?.incluiGrupo) garantir(infoGrupo[g].incluiGrupo);
    return { ...estado, modulos, versaoCatalogo: VERSAO_CATALOGO, migrado: true };
}

function aplicarEstado(estado) {
    const e = Object.assign(estadoPadrao(), migrarEstado(estado) || {});
    const set = (id, v) => { document.getElementById(id).value = v ?? ''; };

    set('cliente', e.identificacao?.cliente);
    set('proposta', e.identificacao?.proposta);
    set('data-doc', e.identificacao?.dataDoc);
    set('qtd-matrizes', e.quantidades?.matrizes ?? '1');
    set('qtd-filiais', e.quantidades?.filiais ?? '0');
    set('qtd-segmentos', e.quantidades?.segmentos ?? '1');
    set('nao-escopo-texto', e.naoEscopo);

    const regra = { ...estadoPadrao().regra, ...(e.regra || {}) };
    document.getElementById('regra-import-adic').checked = !!regra.importacaoAdicional;
    for (const [chave, id] of Object.entries(CAMPOS_REGRA)) set(id, regra[chave]);

    document.querySelector('#tabela-participantes tbody').innerHTML = '';
    (e.participantes || []).forEach(p => addParticipante(p));

    // Escopo por CNPJ
    document.getElementById('cnpj-lista').innerHTML = '';
    refs.cnpjs = [];
    (e.cnpj?.lista || []).forEach(c => addCnpj(c));
    document.getElementById('cnpj-ativo').checked = !!e.cnpj?.ativo;
    document.getElementById('cnpj-painel').hidden = !e.cnpj?.ativo;

    // Zera todos os módulos e depois aplica os salvos
    for (const [categoria, ref] of Object.entries(refs.cats)) {
        definirCategoriaAtiva(categoria, false, true);
        for (const [packName, pack] of Object.entries(ref.packs)) {
            if (pack.hora) {
                pack.hora.value = (horasPorPack[packName] || 0).toFixed(2);
                pack.hora.classList.remove('alterada');
            }
            if (pack.usuarios) pack.usuarios.value = '';
        }
    }
    const ignorados = [];
    for (const [categoria, cat] of Object.entries(e.modulos || {})) {
        const ref = refs.cats[categoria];
        if (!ref) { ignorados.push(categoria); continue; }
        definirCategoriaAtiva(categoria, true, false, false);
        ref.obs.value = cat.obs || '';
        for (const [packName, dadosPack] of Object.entries(cat.packs || {})) {
            const pack = ref.packs[packName];
            if (!pack) { ignorados.push(packName); continue; }
            if (pack.hora && !pack.comMinutos && dadosPack.horas !== undefined && !(e.migrado && !(parseFloat(dadosPack.horas) > 0))) {
                pack.hora.value = num(dadosPack.horas);
                pack.hora.classList.toggle('alterada', num(dadosPack.horas) !== num(horasPorPack[packName]));
            }
            if (dadosPack.selecionarTodos && !pack.usuarios) {
                pack.subs.forEach(s => s.checked = true);
            } else {
                const itens = new Set(dadosPack.itens || []);
                pack.subs.forEach(s => s.checked = itens.has(s.value));
            }
            if (pack.usuarios) pack.usuarios.value = dadosPack.usuarios || '';
        }
    }
    Object.values(refs.cats).forEach(ref => { if (ref.planilha) atualizarTotalUsuarios(ref.planilha); });

    refs.sintonia.forEach(s => { s.el.value = e.sintonia?.[s.chave] || ''; });

    calcularHoras();
    if (!e.migrado) set('horas', e.horasFinal);

    avisoMigracao = !!e.migrado;
    if (e.migrado) toast(MSG_MIGRACAO, true);
    else if (ignorados.length) toast(`Itens que não existem mais na base foram ignorados: ${ignorados.join(', ')}`, true);
}

let avisoMigracao = false;
const MSG_MIGRACAO = 'Simulação de um catálogo anterior: os packs foram atualizados para o catálogo atual e as horas recalculadas pela nova minutagem. Revise antes de salvar.';

/** Compara dois estados e devolve a lista de alterações legíveis: [{t: add|rem|mod, txt}] */
function compararEstados(antes, depois) {
    const mud = [];
    const add = txt => mud.push({ t: 'add', txt });
    const rem = txt => mud.push({ t: 'rem', txt });
    const mod = txt => mud.push({ t: 'mod', txt });
    const a = Object.assign(estadoPadrao(), migrarEstado(antes) || {});
    const d = Object.assign(estadoPadrao(), migrarEstado(depois) || {});

    [
        ['Cliente', a.identificacao.cliente, d.identificacao.cliente],
        ['Proposta', a.identificacao.proposta, d.identificacao.proposta],
        ['Cidade/data', a.identificacao.dataDoc, d.identificacao.dataDoc],
        ['Matrizes/coligadas', a.quantidades.matrizes, d.quantidades.matrizes],
        ['Filiais', a.quantidades.filiais, d.quantidades.filiais],
        ['Segmentos', a.quantidades.segmentos, d.quantidades.segmentos]
    ].forEach(([nome, x, y]) => {
        if (String(x ?? '') !== String(y ?? '')) mod(`${nome}: "${resumir(x) || '—'}" → "${resumir(y) || '—'}"`);
    });

    // Regra de horas
    const ra = { ...estadoPadrao().regra, ...(a.regra || {}) }, rd = { ...estadoPadrao().regra, ...(d.regra || {}) };
    if (!!ra.importacaoAdicional !== !!rd.importacaoAdicional) (rd.importacaoAdicional ? add : rem)(`Importação de dados — pacote adicional (+${REGRA_HORAS.importacaoAdicional} h)`);
    [
        ['customizacao', 'Customização (h)'], ['personalizacao', 'Personalização (h)'],
        ['cnabCobranca', 'Bancos com CNAB de cobrança'], ['cnabPagamento', 'Bancos com CNAB de pagamento'],
        ['ajustePct', 'Ajuste do EV (%)'], ['horasAdicionais', 'Horas adicionais do EV']
    ].forEach(([k, nome]) => { if ((parseFloat(ra[k]) || 0) !== (parseFloat(rd[k]) || 0)) mod(`${nome}: ${parseFloat(ra[k]) || 0} → ${parseFloat(rd[k]) || 0}`); });
    if ((ra.justificativa || '').trim() !== (rd.justificativa || '').trim()) mod('Justificativa do ajuste alterada');

    if (num(a.horasFinal) !== num(d.horasFinal)) mod(`Horas finais: ${num(a.horasFinal)} → ${num(d.horasFinal)}`);
    const calcIgualFinal = num(a.horasCalculadas) === num(a.horasFinal) && num(d.horasCalculadas) === num(d.horasFinal);
    if (num(a.horasCalculadas) !== num(d.horasCalculadas) && !calcIgualFinal) mod(`Horas calculadas: ${num(a.horasCalculadas)} → ${num(d.horasCalculadas)}`);

    // Escopo por CNPJ
    if (!!a.cnpj?.ativo !== !!d.cnpj?.ativo) (d.cnpj?.ativo ? add : rem)('Escopo por CNPJ');
    const chaveC = c => (c.cnpj || c.empresa || '').trim();
    const ca = new Map((a.cnpj?.lista || []).map(c => [chaveC(c), c]));
    const cd = new Map((d.cnpj?.lista || []).map(c => [chaveC(c), c]));
    cd.forEach((c, k) => {
        const o = ca.get(k);
        if (!o) add(`CNPJ ${k}${c.tipo ? ` (${c.tipo})` : ''}`);
        else if (o.tipo !== c.tipo || o.empresa !== c.empresa || [...(o.foraDoEscopo || [])].sort().join() !== [...(c.foraDoEscopo || [])].sort().join()) mod(`CNPJ ${k}: tipo ou processos alterados`);
    });
    ca.forEach((c, k) => { if (!cd.has(k)) rem(`CNPJ ${k}`); });

    // Participantes (identificados pelo nome)
    const chaveP = p => (p.nome || '').trim().toLowerCase();
    const mapaA = new Map(a.participantes.filter(p => p.nome).map(p => [chaveP(p), p]));
    const mapaD = new Map(d.participantes.filter(p => p.nome).map(p => [chaveP(p), p]));
    mapaD.forEach((p, k) => {
        const o = mapaA.get(k);
        if (!o) add(`Participante ${p.nome}`);
        else if (o.cargo !== p.cargo || o.empresa !== p.empresa || !!o.assina !== !!p.assina) mod(`Participante ${p.nome}: dados alterados`);
    });
    mapaA.forEach((p, k) => { if (!mapaD.has(k)) rem(`Participante ${p.nome}`); });

    // Módulos, subprocessos e horas por pack
    new Set([...Object.keys(a.modulos), ...Object.keys(d.modulos)]).forEach(cat => {
        const ca2 = a.modulos[cat], cd2 = d.modulos[cat];
        if (!ca2) add(`Módulo ${cat}`);
        if (!cd2) { rem(`Módulo ${cat}`); return; }
        new Set([...Object.keys(ca2?.packs || {}), ...Object.keys(cd2.packs || {})]).forEach(pack => {
            const pa = ca2?.packs?.[pack], pd = cd2.packs?.[pack];
            const ia = new Set(pa?.itens || []), id = new Set(pd?.itens || []);
            const novos = [...id].filter(i => !ia.has(i));
            const tirados = [...ia].filter(i => !id.has(i));
            if (novos.length) add(`${pack}: ${novos.map(i => resumir(i, 45)).join('; ')}`);
            if (tirados.length) rem(`${pack}: ${tirados.map(i => resumir(i, 45)).join('; ')}`);
            if (!infoPack[pack]?.comMinutos) {
                const ha = pa ? pa.horas : horasPorPack[pack];
                const hd = pd ? pd.horas : horasPorPack[pack];
                if (num(ha) !== num(hd)) mod(`Horas de ${pack}: ${num(ha)} → ${num(hd)}`);
            }
            const ua = pa?.usuarios || 0, ud = pd?.usuarios || 0;
            if (ua !== ud) {
                if (!ua) add(`${pack}: ${ud} usuário(s)`);
                else if (!ud) rem(`${pack}: ${ua} usuário(s)`);
                else mod(`Usuários de ${pack}: ${ua} → ${ud}`);
            }
        });
        if ((ca2?.obs || '') !== (cd2.obs || '')) mod(`Observações de ${cat} alteradas`);
    });

    if ((a.naoEscopo || '').trim() !== (d.naoEscopo || '').trim()) mod('Texto de Não Escopo alterado');

    // Sintonia
    new Set([...Object.keys(a.sintonia), ...Object.keys(d.sintonia)]).forEach(k => {
        const x = (a.sintonia[k] || '').trim(), y = (d.sintonia[k] || '').trim();
        if (x === y) return;
        const pergunta = resumir(k.split('|').slice(2).join('|'), 70);
        if (!x) add(`Sintonia respondida: ${pergunta}`);
        else if (!y) rem(`Sintonia apagada: ${pergunta}`);
        else mod(`Sintonia alterada: ${pergunta}`);
    });

    return mud;
}

function htmlMudancas(mudancas, limite = Infinity) {
    if (!mudancas || !mudancas.length) return '<li>Nenhuma alteração.</li>';
    const sinal = { add: '+', rem: '−', mod: '~' };
    const itens = mudancas.slice(0, limite).map(m => `<li class="${m.t}">${sinal[m.t] || ''} ${esc(m.txt)}</li>`);
    if (mudancas.length > limite) itens.push(`<li>e mais ${mudancas.length - limite} alteração(ões)</li>`);
    return itens.join('');
}

/* ==========================================================================
   6. EXPORTAÇÕES
   ========================================================================== */
function gerarConteudoHtmlEscopo() {
    const e = coletarEstado();
    const cliente = esc(e.identificacao.cliente || 'Não informado');
    const proposta = esc(e.identificacao.proposta || 'Não informado');
    const horas = esc(formatarHorasDocumento(e.horasFinal));
    const dataDoc = esc(e.identificacao.dataDoc.trim() || localDataPadrao());
    const h2 = 'color: #005b52; font-size: 14pt; margin-top: 20pt; border-bottom: 1pt solid #cbd5e1; padding-bottom: 3pt;';

    let htmlWord = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #2c3e50; font-size: 11pt; line-height: 1.4; padding: 20px;">
            <h1 style="color: #005b52; border-bottom: 2pt solid #005b52; padding-bottom: 4pt; font-size: 18pt; margin-bottom: 15pt;">Sankhya - Escopo de projeto</h1>
            <p><strong>Identificação</strong></p>
            <p><strong>Parceiro:</strong> ${cliente} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Número da Proposta:</strong> ${proposta}</p>

            <h2 style="${h2}">Objetivos</h2>
            <p>O objetivo dessa etapa é a identificação de quais procedimentos serão tratados no projeto de implantação.</p>
            <p><strong>Documentos de Entrada:</strong> Proposta Comercial.</p>

            <h2 style="${h2}">Participantes</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15pt;" border="1">
                <tr style="background-color: #f8fafc; font-weight: bold;">
                    <th style="padding: 6pt;">Nome</th><th style="padding: 6pt;">Cargo / Função</th><th style="padding: 6pt;">Empresa</th>
                </tr>`;

    const assinaturas = [];
    e.participantes.forEach(p => {
        if (!p.nome) return;
        htmlWord += `<tr><td style="padding: 6pt;">${esc(p.nome)}</td><td style="padding: 6pt;">${esc(p.cargo)}</td><td style="padding: 6pt;">${esc(p.empresa)}</td></tr>`;
        if (p.assina) assinaturas.push(p);
    });

    htmlWord += `</table><h2 style="${h2}">Rotinas por Módulos</h2>`;

    let temModulosNoEscopo = false;
    for (const categoria of Object.keys(modulosDados)) {
        const cat = e.modulos[categoria];
        if (!cat) continue;
        let temConteudo = false;
        let htmlCat = `<h3 style="font-size: 12pt; margin-bottom: 6pt; color: #1e293b; margin-top: 15pt;">${esc(categoria)}</h3>`;
        const lic = infoGrupo[categoria]?.licenciante;
        if (EXIBIR_LICENCIANTE_NO_ESCOPO && lic && lic !== SANKHYA) {
            htmlCat += `<p style="margin: 0 0 6pt; font-size: 9pt; color: #64748b;">Licenciado por ${esc(lic.nome)}${lic.razaoSocial ? ` - ${esc(lic.razaoSocial)}` : ''}</p>`;
        }

        if (infoGrupo[categoria]?.tipo === 'usuarios') {
            const linhas = Object.keys(modulosDados[categoria])
                .filter(p => cat.packs[p]?.usuarios > 0)
                .map(p => ({ nome: p, codigo: infoPack[p]?.codigo, usuarios: cat.packs[p].usuarios }));
            if (linhas.length) {
                temConteudo = true;
                const td = 'padding: 4pt 6pt; border: 1pt solid #cbd5e1;';
                htmlCat += `<table style="width: 100%; border-collapse: collapse; margin: 6pt 0 8pt;">
                    <tr style="background-color: #f8fafc; font-weight: bold;"><td style="${td}">Solução</td>${EXIBIR_CODIGO_NO_ESCOPO ? `<td style="${td}">Código</td>` : ''}<td style="${td} text-align: right;">Usuários</td></tr>
                    ${linhas.map(l => `<tr><td style="${td}">${esc(l.nome)}</td>${EXIBIR_CODIGO_NO_ESCOPO ? `<td style="${td}">${esc(l.codigo || '—')}</td>` : ''}<td style="${td} text-align: right;">${l.usuarios.toLocaleString('pt-BR')}</td></tr>`).join('')}
                    <tr style="font-weight: bold;"><td style="${td}"${EXIBIR_CODIGO_NO_ESCOPO ? ' colspan="2"' : ''}>Total de usuários</td><td style="${td} text-align: right;">${linhas.reduce((a, l) => a + l.usuarios, 0).toLocaleString('pt-BR')}</td></tr>
                </table>`;
            }
        }

        for (const packName of Object.keys(modulosDados[categoria])) {
            if (infoGrupo[categoria]?.tipo === 'usuarios') break;
            const itens = cat.packs[packName]?.itens || [];
            if (!itens.length) continue;
            temConteudo = true;
            const codigo = infoPack[packName]?.codigo;
            htmlCat += `<p style="margin-bottom: 4pt; margin-top: 8pt;"><strong>${esc(packName)}</strong>${EXIBIR_CODIGO_NO_ESCOPO && codigo ? ` <span style="color: #64748b; font-size: 9pt;">(cód. ${esc(codigo)})</span>` : ''}</p>`;
            // Pack sem rotinas detalhadas: o próprio nome já descreve o item
            const rotinasPack = itens.filter(i => i !== packName);
            if (rotinasPack.length) {
                htmlCat += `<ul style="margin-top: 2pt; margin-bottom: 8pt; padding-left: 20pt;">`;
                rotinasPack.forEach(i => htmlCat += `<li>${esc(i)}.</li>`);
                htmlCat += `</ul>`;
            }
        }
        if (cat.obs) {
            temConteudo = true;
            htmlCat += `<div style="border-left: 3pt solid #005b52; padding-left: 10pt; margin-top: 10pt; font-style: italic; color: #475569;"><p><strong>Observações:</strong><br>${esc(cat.obs).replace(/\n/g, '<br>')}</p></div>`;
        }
        if (temConteudo) { htmlWord += htmlCat; temModulosNoEscopo = true; }
    }
    if (!temModulosNoEscopo) htmlWord += `<p><em>Nenhum módulo foi selecionado.</em></p>`;

    // Escopo por CNPJ
    const regraAtual = ultimaRegra || calcularRegra();
    if (regraAtual.cnpj.emUso) {
        const td = 'padding: 4pt 6pt; border: 1pt solid #cbd5e1; vertical-align: top;';
        htmlWord += `<h2 style="${h2}">Escopo por CNPJ</h2>
            <p>Empresas do grupo e processos que cada uma utiliza no projeto.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 12pt;">
                <tr style="background-color: #f8fafc; font-weight: bold;">
                    <td style="${td}">CNPJ</td><td style="${td}">Empresa</td><td style="${td}">Tipo</td><td style="${td}">Processos que não utiliza</td>
                </tr>
                ${regraAtual.cnpj.linhas.map(l => `<tr><td style="${td} white-space: nowrap;">${esc(l.cnpj || '—')}</td><td style="${td}">${esc(l.empresa || '—')}</td><td style="${td}">${esc((l.tipo || '—').replace(' (já incluso)', ''))}</td><td style="${td}">${esc(l.naoUsa.join(', ') || 'Utiliza todos os processos do escopo')}</td></tr>`).join('')}
            </table>`;
    }

    const naoEscopo = e.naoEscopo.trim();
    htmlWord += `<h2 style="${h2}">NÃO ESCOPO</h2><p>Não serão considerados neste projeto as seguintes rotinas e itens:</p>`;
    htmlWord += `<p style="margin-bottom: 12pt;">${naoEscopo ? esc(naoEscopo).replace(/\n/g, '<br>') : 'Nenhuma rotina especificada.'}</p>`;

    let blocoAssinaturas = `<table style="width: 100%; border: none; margin-top: 40pt; page-break-inside: avoid;"><tr>`;
    assinaturas.forEach((ass, index) => {
        if (index > 0 && index % 2 === 0) blocoAssinaturas += `</tr><tr><td colspan="2" style="border: none; padding: 20pt;"></td></tr><tr>`;
        blocoAssinaturas += `
            <td style="width: 50%; border: none; text-align: center; vertical-align: bottom; padding: 10pt;">
                <div style="border-top: 1pt solid black; margin: 0 auto; width: 85%; padding-top: 5pt; line-height: 1.2;">
                    <strong>${esc(ass.nome)}</strong><br>${esc(ass.cargo)} - ${esc(ass.empresa)}
                </div>
            </td>`;
    });
    if (assinaturas.length % 2 !== 0) blocoAssinaturas += `<td style="width: 50%; border: none;"></td>`;
    blocoAssinaturas += `</tr></table>`;

    htmlWord += `
            <h2 style="${h2} page-break-before: auto;">Validação da Etapa</h2>
            <p>O volume de horas estimadas para este projeto é de <strong>${horas} horas</strong>.</p>
            <p>A implantação será por Banco de Horas com faturamento mensal: Consultoria e apoio na definição de processos, assessoria para configuração, parametrização e utilização do sistema.</p>
            <p>Havendo processos específicos não listados, os mesmos deverão ser negociados adicionalmente.</p>
            <p>Concordamos com a veracidade das informações e validamos a execução desta etapa.</p>
            ${dataDoc ? `<p style="margin-top: 20pt; font-weight: bold;">${dataDoc}</p>` : ''}
            <br>
            ${blocoAssinaturas}
        </div>`;
    return htmlWord;
}

/** Local padrão do documento quando o campo "Cidade/UF e Data" não é preenchido. */
const LOCAL_PADRAO = 'Campo Grande/MS';

/** "Campo Grande/MS, 12 de novembro de 2026" com a data de hoje. */
function localDataPadrao(data = new Date()) {
    const dataExtenso = data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${LOCAL_PADRAO}, ${dataExtenso}`;
}

/** Horas no padrão brasileiro: 466 → "466"; 466.5 → "466,5"; 1415 → "1.415". */
function formatarHorasDocumento(valor) {
    const n = parseFloat(String(valor ?? '').replace(',', '.')) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Nome base dos arquivos exportados; inclui a versão quando a simulação está salva e sem alterações. */
function nomeBaseExportacao(prefixo) {
    const cliente = (document.getElementById('cliente').value || 'Projeto').replace(/\s+/g, '_');
    const sufixo = simAtual && !haAlteracoes() ? `_v${pad3(simAtual.versao)}` : '';
    return `${prefixo}_${cliente}${sufixo}`;
}

/**
 * MODELO DE DOCUMENTO — usado pelas duas exportações (Word e HTML), para que os
 * arquivos saiam com o mesmo layout. O conteúdo usa estilos inline (lidos pelo
 * Word); o <style> abaixo só ajusta a visualização e a impressão no navegador.
 */
function documentoModelo(titulo, corpo, { paisagem = false, paraWord = false } = {}) {
    const versao = simAtual && !haAlteracoes() ? ` · versão v${pad3(simAtual.versao)}` : '';
    const gerado = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
    @page { size: A4 ${paisagem ? 'landscape' : 'portrait'}; margin: 15mm; }${paraWord ? '' : `
    body { margin: 0; background: #f1f5f9; }`}
    .folha { max-width: ${paisagem ? '1100px' : '820px'}; margin: 24px auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .rodape-doc { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8pt; color: #94a3b8; padding: 0 20px 16px; }
    @media print { body { background: #fff; } .folha { margin: 0; max-width: none; box-shadow: none; } }
</style>
</head>
<body>
<div class="folha">
${corpo}
</div>
</body>
</html>`;
}

function exportarWord(titulo, corpo, nomeArquivo, opcoes = {}) {
    if (typeof htmlDocx === 'undefined') {
        return toast('A biblioteca do Word não carregou (verifique a internet). Use a exportação HTML.', true);
    }
    const blob = htmlDocx.asBlob(documentoModelo(titulo, corpo, { ...opcoes, paraWord: true }), { orientation: opcoes.paisagem ? 'landscape' : 'portrait' });
    baixarBlob(blob, `${nomeArquivo}.docx`);
}

/** Abre o documento HTML em uma nova aba (sem baixar arquivo). */
function exportarHtml(titulo, corpo, nomeArquivo, opcoes = {}) {
    const blob = new Blob([documentoModelo(titulo, corpo, opcoes)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const aba = window.open(url, '_blank');
    if (!aba) {
        URL.revokeObjectURL(url);
        return toast('O navegador bloqueou a nova aba. Permita pop-ups para esta página e tente de novo.', true);
    }
    // Libera a memória depois que a aba já carregou o documento
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// --- Escopo ---
function gerarWordEscopo() { exportarWord('Escopo Sankhya', gerarConteudoHtmlEscopo(), nomeBaseExportacao('Escopo')); }
function gerarHtmlEscopo() { exportarHtml('Escopo Sankhya', gerarConteudoHtmlEscopo(), nomeBaseExportacao('Escopo')); }

// --- Sintonia Comercial ---
function gerarConteudoHtmlSintonia() {
    const cliente = esc(document.getElementById('cliente').value || 'Projeto');
    const proposta = esc(document.getElementById('proposta').value || 'Não informado');
    const td = 'padding: 5pt 6pt; border: 1pt solid #cbd5e1; vertical-align: top;';
    let html = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #2c3e50; font-size: 10pt; line-height: 1.35; padding: 20px;">
            <h1 style="color: #005b52; border-bottom: 2pt solid #005b52; padding-bottom: 4pt; font-size: 18pt; margin-bottom: 10pt;">Sankhya - Levantamento para Sintonia Comercial</h1>
            <p><strong>Parceiro:</strong> ${cliente} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Número da Proposta:</strong> ${proposta}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10pt;">
                <tr style="background-color: #f8fafc; font-weight: bold;">
                    <td style="${td} width: 16%;">Categoria</td>
                    <td style="${td} width: 42%;">Questionamento / Campo de Dados</td>
                    <td style="${td} width: 42%;">Resposta / Observação</td>
                </tr>`;
    let i = 0;
    sintoniaData.forEach(item => {
        if (item.type === 'header') {
            html += `<tr><td colspan="3" style="${td} background-color: #e2e8f0; font-weight: bold; text-align: center; color: #005b52;">${esc(item.title)}</td></tr>`;
        } else {
            const resp = esc(refs.sintonia[i++].el.value).replace(/\n/g, '<br>');
            html += `<tr><td style="${td}">${esc(item.categoria)}</td><td style="${td}">${esc(item.questionamento)}</td><td style="${td}">${resp}</td></tr>`;
        }
    });
    html += `</table></div>`;
    return html;
}

function gerarWordSintonia() { exportarWord('Sintonia Comercial Sankhya', gerarConteudoHtmlSintonia(), nomeBaseExportacao('Sintonia'), { paisagem: true }); }
function gerarHtmlSintonia() { exportarHtml('Sintonia Comercial Sankhya', gerarConteudoHtmlSintonia(), nomeBaseExportacao('Sintonia'), { paisagem: true }); }

/* ==========================================================================
   7. PASTA DE SIMULAÇÕES
   A pasta escolhida fica lembrada no IndexedDB do navegador. Ao reabrir a
   ferramenta, um clique em "Reconectar pasta" libera a permissão de novo.
   ========================================================================== */
let pastaSimulacoes = null;   // FileSystemDirectoryHandle de /simulacoes
let pastaPendente = null;     // handle lembrado, aguardando permissão
let pastaRaizNome = '';
let cacheSimulacoes = [];     // [{ pasta, cliente, proposta, versoes: [...] }]

const IDB_NOME = 'gerador-sankhya', IDB_STORE = 'config';
function idb(modo, fn) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NOME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const tx = req.result.transaction(IDB_STORE, modo);
            const r = fn(tx.objectStore(IDB_STORE));
            tx.oncomplete = () => resolve(r?.result);
            tx.onerror = () => reject(tx.error);
        };
    });
}
const idbGet = chave => idb('readonly', s => s.get(chave));
const idbSet = (chave, valor) => idb('readwrite', s => s.put(valor, chave));

async function obterPastaSimulacoes(raiz) {
    // Aceita tanto a pasta "gerador-sankhya" quanto a própria "simulacoes"
    if (raiz.name.toLowerCase() === PASTA_SIMULACOES) return raiz;
    return raiz.getDirectoryHandle(PASTA_SIMULACOES, { create: true });
}

async function conectarPasta() {
    if (!SUPORTA_PASTA) {
        toast('Este navegador não grava direto em pastas. Use Chrome ou Edge, ou salve baixando o arquivo.', true);
        return false;
    }
    try {
        if (pastaPendente) {
            const perm = await pastaPendente.requestPermission({ mode: 'readwrite' });
            pastaSimulacoes = perm === 'granted' ? pastaPendente : null;
            pastaPendente = null;
            if (!pastaSimulacoes) { atualizarStatusPasta(); toast('Permissão negada. Escolha a pasta novamente.', true); return false; }
        } else {
            const raiz = await window.showDirectoryPicker({ id: 'gerador-sankhya', mode: 'readwrite' });
            pastaRaizNome = raiz.name;
            pastaSimulacoes = await obterPastaSimulacoes(raiz);
            await idbSet('pastaSimulacoes', pastaSimulacoes);
            await idbSet('pastaRaizNome', pastaRaizNome);
        }
        atualizarStatusPasta();
        await listarSimulacoes();
        toast('Pasta conectada.');
        return true;
    } catch (err) {
        if (err.name !== 'AbortError') toast(`Não foi possível acessar a pasta: ${err.message}`, true);
        return false;
    }
}

async function restaurarPasta() {
    if (SUPORTA_PASTA) {
        try {
            const handle = await idbGet('pastaSimulacoes');
            pastaRaizNome = (await idbGet('pastaRaizNome')) || '';
            if (handle) {
                const perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm === 'granted') { pastaSimulacoes = handle; await listarSimulacoes(); }
                else pastaPendente = handle;
            }
        } catch { /* nenhuma pasta lembrada */ }
    }
    atualizarStatusPasta();
}

function caminhoPasta() {
    const raiz = pastaRaizNome && pastaRaizNome.toLowerCase() !== PASTA_SIMULACOES ? `${pastaRaizNome}/` : '';
    return `${raiz}${PASTA_SIMULACOES}`;
}

function atualizarStatusPasta() {
    const box = document.getElementById('pasta-status');
    const texto = document.getElementById('pasta-texto');
    const btn = document.getElementById('btn-conectar');
    box.classList.toggle('conectada', !!pastaSimulacoes);
    document.getElementById('btn-atualizar').hidden = !pastaSimulacoes;
    document.getElementById('instrucoes-pasta').hidden = !!pastaSimulacoes;

    if (!SUPORTA_PASTA) {
        texto.innerHTML = 'Este navegador não permite gravar direto na pasta. Ao salvar, o arquivo da versão é baixado: mova-o para <strong>gerador-sankhya/simulacoes</strong>. Para gravação automática, use Chrome ou Edge.';
        btn.hidden = true;
    } else if (pastaSimulacoes) {
        texto.innerHTML = `Salvando em <span class="pasta-caminho">${esc(caminhoPasta())}</span>`;
        btn.textContent = 'Trocar pasta';
        btn.className = 'btn btn-sec';
    } else if (pastaPendente) {
        texto.innerHTML = `A pasta <span class="pasta-caminho">${esc(caminhoPasta())}</span> precisa ser liberada novamente.`;
        btn.textContent = 'Reconectar pasta';
        btn.className = 'btn';
    } else {
        texto.textContent = 'Nenhuma pasta conectada.';
        btn.textContent = 'Conectar pasta do projeto';
        btn.className = 'btn';
    }
    renderizarListaSimulacoes();
}

async function lerJson(fileHandle) {
    const arquivo = await fileHandle.getFile();
    return JSON.parse(await arquivo.text());
}

function validarArquivo(json) {
    if (!json || json.app !== APP_ID || !json.dados || !json.versao) throw new Error('o arquivo não é uma simulação do Gerador de Escopo');
    return json;
}

async function listarSimulacoes() {
    if (!pastaSimulacoes) { renderizarListaSimulacoes(); return; }
    const lista = [];
    try {
        for await (const [nome, handle] of pastaSimulacoes.entries()) {
            if (handle.kind !== 'directory') continue;
            const sim = { pasta: nome, cliente: '', proposta: '', versoes: [] };
            for await (const [arq, fh] of handle.entries()) {
                if (fh.kind !== 'file' || !arq.toLowerCase().endsWith('.json')) continue;
                try {
                    const json = validarArquivo(await lerJson(fh));
                    sim.versoes.push({ arquivo: arq, handle: fh, versao: json.versao, simulacao: json.simulacao });
                } catch { /* arquivo que não é versão: ignorado */ }
            }
            if (!sim.versoes.length) continue;
            sim.versoes.sort((x, y) => y.versao.numero - x.versao.numero);
            sim.cliente = sim.versoes[0].simulacao?.cliente || nome;
            sim.proposta = sim.versoes[0].simulacao?.proposta || '';
            lista.push(sim);
        }
    } catch (err) {
        toast(`Erro ao ler a pasta: ${err.message}`, true);
    }
    lista.sort((x, y) => (y.versoes[0].versao.criadaEm || '').localeCompare(x.versoes[0].versao.criadaEm || ''));
    cacheSimulacoes = lista;
    renderizarListaSimulacoes();
}

function renderizarListaSimulacoes() {
    const alvo = document.getElementById('lista-simulacoes');
    const filtro = document.getElementById('filtro-sim').value.trim().toLowerCase();

    if (!pastaSimulacoes) {
        alvo.innerHTML = `<div class="vazio">${SUPORTA_PASTA
            ? 'Conecte a pasta do projeto para ver as simulações salvas, ou importe um arquivo .json de versão.'
            : 'Importe um arquivo .json de versão para continuar a edição.'}</div>`;
        return;
    }
    const sims = cacheSimulacoes.filter(s => !filtro || `${s.cliente} ${s.proposta} ${s.pasta}`.toLowerCase().includes(filtro));
    if (!sims.length) {
        alvo.innerHTML = `<div class="vazio">${filtro
            ? 'Nenhuma simulação encontrada para esse filtro.'
            : 'Nenhuma simulação salva ainda. Preencha o escopo e clique em Salvar versão.'}</div>`;
        return;
    }

    alvo.innerHTML = sims.map((sim, si) => {
        const ultima = sim.versoes[0].versao;
        const ehAtual = simAtual && simAtual.pasta === sim.pasta;
        return `
        <details class="sim-item ${ehAtual ? 'atual' : ''}" ${ehAtual ? 'open' : ''}>
            <summary>
                <span class="sim-titulo">${esc(sim.cliente)}
                    <small>Proposta ${esc(sim.proposta || '—')}, pasta ${esc(sim.pasta)}</small>
                </span>
                <span class="sim-resumo">${sim.versoes.length} ${sim.versoes.length === 1 ? 'versão' : 'versões'}, última v${pad3(ultima.numero)} em ${formatarDataHora(ultima.criadaEm)}</span>
            </summary>
            <ul class="versoes">
                ${sim.versoes.map((v, vi) => {
                    const ver = v.versao;
                    const carregada = ehAtual && simAtual.versao === ver.numero;
                    const origem = ver.baseadaEm && ver.baseadaEm !== ver.numero - 1 ? `, a partir da v${pad3(ver.baseadaEm)}` : '';
                    return `
                    <li class="versao ${carregada ? 'carregada' : ''}">
                        <span class="versao-num">v${pad3(ver.numero)}</span>
                        <div>
                            <div class="versao-meta">${formatarDataHora(ver.criadaEm)}${ver.autor ? ` por ${esc(ver.autor)}` : ''}${origem}, ${esc(num(ver.horasFinal))} h${carregada ? ' (aberta agora)' : ''}</div>
                            ${ver.comentario ? `<p class="versao-coment">${esc(ver.comentario)}</p>` : ''}
                            <ul class="versao-mudancas">${ver.numero === 1 && !ver.alteracoes?.length ? '<li>Primeira versão.</li>' : htmlMudancas(ver.alteracoes, 6)}</ul>
                        </div>
                        <div class="versao-acoes">
                            <button class="btn" type="button" onclick="abrirVersao(${si}, ${vi})">Abrir</button>
                            <button class="btn btn-sec" type="button" onclick="compararComTela(${si}, ${vi})">Comparar com a tela</button>
                            <button class="btn btn-sec" type="button" onclick="baixarVersao(${si}, ${vi})">Baixar</button>
                        </div>
                    </li>`;
                }).join('')}
            </ul>
        </details>`;
    }).join('');
    simsRenderizadas = sims;
}
let simsRenderizadas = [];

/* ==========================================================================
   8. SALVAR, ABRIR, COMPARAR E IMPORTAR
   ========================================================================== */
let simAtual = null;          // { pasta, versao, maiorVersao, arquivo, estado, cliente, proposta }
let estadoSalvoJson = null;   // usado para detectar alterações não salvas
let salvamentoPendente = null;

function haAlteracoes() {
    return estadoSalvoJson !== null && JSON.stringify(coletarEstado()) !== estadoSalvoJson;
}

function confirmarDescarte() {
    return !haAlteracoes() || confirm('Há alterações não salvas. Deseja descartá-las?');
}

function definirAtual(sim, estado) {
    simAtual = sim;
    estadoSalvoJson = JSON.stringify(estado);
    atualizarBarra();
}

function atualizarBarra() {
    const nome = document.getElementById('sim-nome');
    const versao = document.getElementById('sim-versao');
    const status = document.getElementById('sim-status');
    const sujo = haAlteracoes();

    if (simAtual) {
        nome.textContent = `${simAtual.cliente || simAtual.pasta}${simAtual.proposta ? ` (proposta ${simAtual.proposta})` : ''}`;
        versao.hidden = false;
        versao.textContent = `v${pad3(simAtual.versao)}`;
        status.textContent = sujo ? 'Alterações não salvas' : 'Sem alterações';
    } else {
        nome.textContent = 'Nova simulação';
        versao.hidden = true;
        status.textContent = sujo ? 'Alterações não salvas' : 'Não salva';
    }
    status.classList.toggle('sujo', sujo);
}

let timerVerificacao;
function agendarVerificacao() {
    clearTimeout(timerVerificacao);
    timerVerificacao = setTimeout(atualizarBarra, 250);
}

function novaSimulacao() {
    if (!confirmarDescarte()) return;
    aplicarEstado(estadoPadrao());
    definirAtual(null, coletarEstado());
    renderizarListaSimulacoes();
    openTab('tab-escopo');
    toast('Nova simulação iniciada.');
}

/** Lê a subpasta e devolve o próximo número de versão e o arquivo mais recente. */
async function inspecionarPasta(dirHandle) {
    let maior = 0, ultimoArquivo = null;
    for await (const [arq, fh] of dirHandle.entries()) {
        if (fh.kind !== 'file' || !arq.toLowerCase().endsWith('.json')) continue;
        let n = 0;
        try { n = validarArquivo(await lerJson(fh)).versao.numero || 0; }
        catch { n = parseInt((arq.match(/^v(\d+)/i) || [])[1] || '0', 10); }
        if (n > maior) { maior = n; ultimoArquivo = fh; }
    }
    return { proxima: maior + 1, ultimoArquivo };
}

async function abrirModalSalvar() {
    const estado = coletarEstado();
    const { cliente, proposta } = estado.identificacao;
    if (!cliente) {
        openTab('tab-escopo');
        document.getElementById('cliente').focus();
        toast('Informe o Parceiro (Cliente) antes de salvar.', true);
        return;
    }

    // Conecta a pasta no mesmo clique, se ainda não estiver conectada
    if (SUPORTA_PASTA && !pastaSimulacoes) {
        if (!(await conectarPasta())) return;
    }

    const pasta = nomePasta(cliente, proposta);
    const mesmaSimulacao = simAtual && simAtual.pasta === pasta;
    let numero = 1, base = mesmaSimulacao ? simAtual.estado : null, destino;

    try {
        if (pastaSimulacoes) {
            const dir = await pastaSimulacoes.getDirectoryHandle(pasta, { create: false }).catch(() => null);
            if (dir) {
                const info = await inspecionarPasta(dir);
                numero = info.proxima;
                if (!base && info.ultimoArquivo) base = validarArquivo(await lerJson(info.ultimoArquivo)).dados;
            }
            destino = `${caminhoPasta()}/${pasta}/v${pad3(numero)}_${carimboArquivo()}.json`;
        } else {
            numero = mesmaSimulacao ? (simAtual.maiorVersao || simAtual.versao) + 1 : 1;
            destino = `download de ${pasta}_v${pad3(numero)}.json (mova para gerador-sankhya/simulacoes/${pasta}/)`;
        }
    } catch (err) {
        toast(`Não foi possível ler a pasta: ${err.message}`, true);
        return;
    }

    const mudancas = base ? compararEstados(base, estado) : [];
    salvamentoPendente = { estado, pasta, numero, mudancas, baseadaEm: mesmaSimulacao ? simAtual.versao : null };

    document.getElementById('modal-salvar-titulo').textContent = numero === 1 ? 'Salvar primeira versão' : `Salvar versão v${pad3(numero)}`;
    document.getElementById('modal-destino').innerHTML =
        (simAtual && !mesmaSimulacao ? '<strong>Cliente ou proposta diferente da simulação aberta:</strong> a versão vai para outra pasta.<br>' : '') +
        `Destino: <strong>${esc(destino)}</strong>`;
    document.getElementById('modal-mudancas').innerHTML = base ? htmlMudancas(mudancas) : '<li>Primeira versão desta simulação.</li>';
    document.getElementById('versao-autor').value = lerPreferencia('gerador-sankhya-autor');
    document.getElementById('versao-comentario').value = '';
    document.getElementById('modal-salvar').classList.add('aberto');
    document.getElementById('versao-comentario').focus();
}

function fecharModal(id) { document.getElementById(id).classList.remove('aberto'); }
function fecharModalSalvar() { fecharModal('modal-salvar'); salvamentoPendente = null; }

async function confirmarSalvarVersao() {
    if (!salvamentoPendente) return;
    const btn = document.getElementById('btn-confirmar-salvar');
    btn.disabled = true;

    const { estado, pasta, mudancas, baseadaEm } = salvamentoPendente;
    let { numero } = salvamentoPendente;
    const autor = document.getElementById('versao-autor').value.trim();
    const comentario = document.getElementById('versao-comentario').value.trim();
    gravarPreferencia('gerador-sankhya-autor', autor);

    const montarArquivo = n => ({
        app: APP_ID,
        formato: FORMATO_ARQUIVO,
        simulacao: { pasta, cliente: estado.identificacao.cliente, proposta: estado.identificacao.proposta },
        versao: { numero: n, criadaEm: new Date().toISOString(), autor, comentario, baseadaEm, horasFinal: estado.horasFinal, alteracoes: mudancas },
        dados: estado
    });

    try {
        let arquivo;
        if (pastaSimulacoes) {
            const dir = await pastaSimulacoes.getDirectoryHandle(pasta, { create: true });
            // Recalcula na hora de gravar: nunca sobrescreve uma versão existente
            numero = Math.max(numero, (await inspecionarPasta(dir)).proxima);
            arquivo = `v${pad3(numero)}_${carimboArquivo()}.json`;
            const fh = await dir.getFileHandle(arquivo, { create: true });
            const w = await fh.createWritable();
            await w.write(JSON.stringify(montarArquivo(numero), null, 2));
            await w.close();
        } else {
            arquivo = `${pasta}_v${pad3(numero)}.json`;
            baixarBlob(new Blob([JSON.stringify(montarArquivo(numero), null, 2)], { type: 'application/json' }), arquivo);
        }

        definirAtual({
            pasta, versao: numero, maiorVersao: numero, arquivo, estado,
            cliente: estado.identificacao.cliente, proposta: estado.identificacao.proposta
        }, estado);
        fecharModalSalvar();
        toast(`Versão v${pad3(numero)} salva.`);
        if (pastaSimulacoes) await listarSimulacoes();
    } catch (err) {
        toast(`Não foi possível salvar: ${err.message}`, true);
    } finally {
        btn.disabled = false;
    }
}

function carregarJson(json, arquivo) {
    aplicarEstado(json.dados);
    const estado = coletarEstado();
    const ident = json.dados.identificacao || {};
    definirAtual({
        pasta: json.simulacao?.pasta || nomePasta(ident.cliente, ident.proposta),
        versao: json.versao.numero || 1,
        maiorVersao: json.versao.numero || 1,
        arquivo,
        estado,
        cliente: json.simulacao?.cliente || ident.cliente,
        proposta: json.simulacao?.proposta || ident.proposta
    }, estado);
}

async function abrirVersao(si, vi) {
    const sim = simsRenderizadas[si], v = sim?.versoes[vi];
    if (!v) return toast('Versão não encontrada. Atualize a lista.', true);
    if (!confirmarDescarte()) return;
    try {
        const json = validarArquivo(await lerJson(v.handle));
        carregarJson(json, v.arquivo);
        simAtual.maiorVersao = sim.versoes[0].versao.numero;
        renderizarListaSimulacoes();
        openTab('tab-escopo');
        toast(avisoMigracao ? MSG_MIGRACAO : `v${pad3(json.versao.numero)} aberta. Ao salvar, será criada a v${pad3(simAtual.maiorVersao + 1)}.`, avisoMigracao);
    } catch (err) {
        toast(`Não foi possível abrir: ${err.message}`, true);
    }
}

async function compararComTela(si, vi) {
    const sim = simsRenderizadas[si], v = sim?.versoes[vi];
    if (!v) return;
    try {
        const json = validarArquivo(await lerJson(v.handle));
        document.getElementById('modal-info-titulo').textContent = `v${pad3(json.versao.numero)} comparada com a tela`;
        document.getElementById('modal-info-sub').textContent = `O que está diferente na tela em relação à v${pad3(json.versao.numero)} de ${sim.cliente}.`;
        document.getElementById('modal-info-lista').innerHTML = htmlMudancas(compararEstados(json.dados, coletarEstado()));
        document.getElementById('modal-info').classList.add('aberto');
    } catch (err) {
        toast(`Não foi possível comparar: ${err.message}`, true);
    }
}

async function baixarVersao(si, vi) {
    const sim = simsRenderizadas[si], v = sim?.versoes[vi];
    if (!v) return;
    baixarBlob(await v.handle.getFile(), `${sim.pasta}_${v.arquivo}`);
}

async function importarArquivo(evento) {
    const arquivo = evento.target.files[0];
    evento.target.value = '';
    if (!arquivo || !confirmarDescarte()) return;
    try {
        const json = validarArquivo(JSON.parse(await arquivo.text()));
        carregarJson(json, arquivo.name);

        // Com a pasta conectada, a próxima versão segue a numeração que já existe lá
        if (pastaSimulacoes) {
            const dir = await pastaSimulacoes.getDirectoryHandle(simAtual.pasta, { create: false }).catch(() => null);
            if (dir) simAtual.maiorVersao = Math.max(simAtual.versao, (await inspecionarPasta(dir)).proxima - 1);
        }
        atualizarBarra();
        renderizarListaSimulacoes();
        openTab('tab-escopo');
        toast(avisoMigracao ? MSG_MIGRACAO : `Importado: ${simAtual.cliente} v${pad3(json.versao.numero)}. Ao salvar, será criada a v${pad3(simAtual.maiorVersao + 1)}.`, avisoMigracao);
    } catch (err) {
        toast(`Não foi possível importar: ${err.message}`, true);
    }
}

/* ==========================================================================
   9. INICIALIZAÇÃO
   ========================================================================== */
function iniciar() {
    document.getElementById('data-doc').placeholder = `Em branco, o documento usa: ${localDataPadrao()}`;
    montarModulos();
    filtrarPacks();
    montarSintonia();
    aplicarEstado(estadoPadrao());
    definirAtual(null, coletarEstado());

    // Detecta alterações nos campos das abas de edição
    ['tab-escopo', 'tab-sintonia'].forEach(id => {
        const aba = document.getElementById(id);
        aba.addEventListener('input', agendarVerificacao);
        aba.addEventListener('change', agendarVerificacao);
    });

    // Modais: fecham com Esc ou clique no fundo
    document.querySelectorAll('.modal-fundo').forEach(m => m.addEventListener('click', e => {
        if (e.target !== m) return;
        m.id === 'modal-salvar' ? fecharModalSalvar() : fecharModal(m.id);
    }));

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            fecharModal('modal-info');
            if (document.getElementById('modal-salvar').classList.contains('aberto')) fecharModalSalvar();
        }
        // Ctrl+S salva uma nova versão
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (!document.getElementById('modal-salvar').classList.contains('aberto')) abrirModalSalvar();
        }
    });

    window.addEventListener('beforeunload', e => {
        if (haAlteracoes()) { e.preventDefault(); e.returnValue = ''; }
    });

    restaurarPasta();
}

iniciar();
