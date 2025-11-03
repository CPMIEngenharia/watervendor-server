// V12 - "Raio-X". Logando o body ANTES da assinatura.
const express = require('express');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
// const mqtt = require('mqtt'); // <-- MQTT AINDA DESATIVADO

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE 🔒
// =================================================================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
// =================================================================

// Verificação de inicialização
if (!MP_ACCESS_TOKEN || !MP_WEBHOOK_SECRET) {
    console.error('❌ ERRO FATAL: Variáveis de ambiente (MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET) não definidas.');
}

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('V12 - 🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);

// --- Middlewares ---
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar (v12).');
    res.send('Servidor da Máquina de Água (v12 - Raio-X) está no ar e operante.');
});

// --- HANDLER GET (PARA DEPURAÇÃO DO 404 DO MP) ---
app.get('/notificacao-mp', (req, res) => {
    console.warn('⚠️ AVISO: Recebida uma requisição GET na rota /notificacao-mp. Esta rota só aceita POST.');
    res.status(405).send('Method Not Allowed: Esta rota só aceita POST.');
});

// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA (POST) ---');
    
    // =============================================================
    // --- NOVO LOG DE RAIO-X ---
    // Vamos logar o corpo (body) e os cabeçalhos (headers) PRIMEIRO
    // para ver onde o ID realmente está.
    // =============================================================
    try {
        console.log('--- CABEÇALHOS (HEADERS) RECEBIDOS ---');
        console.log(JSON.stringify(req.headers, null, 2));
        console.log('--- CORPO (BODY) RECEBIDO ---');
        console.log(JSON.stringify(req.body, null, 2));
    } catch (e) {
        console.error("Erro ao logar o body:", e.message);
    }

    
    // === INÍCIO DA VALIDAÇÃO DE ASSINATURA ===
    try {
        const signatureHeader = req.headers['x-signature'];
        const requestId = req.headers['x-request-id'];
        
        if (!signatureHeader || !requestId) {
            console.error('❌ Erro de Assinatura: Cabeçalhos ausentes.');
            return res.sendStatus(400); 
        }

        const parts = signatureHeader.split(',').reduce((acc, part) => {
            const [key, value] = part.split('=');
            acc[key.trim()] = value.trim();
            return acc;
        }, {});

        const ts = parts.ts;
        const receivedHash = parts.v1;

        if (!ts || !receivedHash) {
            console.error('❌ Erro de Assinatura: Formato do cabeçalho inválido.');
            return res.sendStatus(400);
        }

        // Tentativa de encontrar o ID (pode falhar)
        const notificationId = req.query.id || req.body.data?.id; 

        if (!notificationId) {
            console.error('❌ Erro de Assinatura: ID da notificação ausente (query.id ou body.data.id).');
            // Como falhou, vamos apenas responder 200 (OK) para o MP parar de tentar
            // Nós já logamos o body acima, então podemos depurar.
            return res.sendStatus(200);
        }

        const baseString = `id:${notificationId};request-id:${requestId};ts:${ts};`;
        const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET);
        hmac.update(baseString);
        const generatedHash = hmac.digest('hex');

        if (generatedHash !== receivedHash) {
            console.error('❌ ERRO DE ASSINATURA: Assinatura inválida! Webhook rejeitado.');
            return res.sendStatus(403); 
        }
        console.log('✅ Assinatura de Webhook validada com sucesso.');
    } catch (error) {
        console.error('💥 Erro fatal durante a validação da assinatura:', error.message);
        return res.sendStatus(500);
    }
    // === FIM DA VALIDAÇÃO DE ASSINATURA ===
    
    // (O resto do processamento está aqui, mas provavelmente falhará
    // até corrigirmos o local do ID)
    
    // --- Processamento do Pagamento ---
    const notificacao = req.body;

    if (notificacao.type === 'payment') {
        const paymentId = notificacao.data?.id; 
        if (!paymentId) {
            console.warn('⚠️ Notificação de pagamento sem ID (data.id). Ignorando.');
            return res.sendStatus(200);
        }
        console.log(`🔎 Notificação de pagamento recebida. ID: ${paymentId}. Buscando detalhes...`);

        try {
            const paymentDetails = await mpPayment.get({ id: paymentId });
            if (paymentDetails.status === 'approved') {
                console.log('✅ PAGAMENTO APROVADO!');
                console.warn('⚠️ Ação MQTT está DESATIVADA (para testes).');
            } else {
                console.log(`⏳ Pagamento ${paymentId} ainda está "${paymentDetails.status}". Aguardando.`);
            }
        } catch (error) {
            console.error(`💥 Erro ao processar o pagamento ${paymentId}:`, error.message);
        }
    } else {
        console.log(`ℹ️ Recebido evento do tipo "${notificacao.type}". Ignorando (focando em "payment").`);
    }

    res.sendStatus(200); // Responde 200 (OK) para o MP
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor da máquina de águia (V12 - Raio-X) iniciado e rodando na porta ${PORT}`);
});