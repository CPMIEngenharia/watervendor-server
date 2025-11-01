// V11 - "Começando de Novo". MQTT DESATIVADO.
const express = require('express');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
// const mqtt = require('mqtt'); // <-- MQTT DESATIVADO

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE 🔒
// =================================================================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
// As variáveis MQTT não são usadas nesta versão
// =================================================================

// Verificação de inicialização
if (!MP_ACCESS_TOKEN || !MP_WEBHOOK_SECRET) {
    console.error('❌ ERRO FATAL: Variáveis de ambiente (MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET) não definidas.');
}

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('V11 - 🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);

/*
// --- Configuração do Cliente MQTT (DESATIVADO) ---
console.log('V11 - 🔌 Conexão MQTT está DESATIVADA.');
const mqttClient = { publish: () => {} }; // Objeto falso para não quebrar
*/

// --- Middlewares ---
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar (v11).');
    res.send('Servidor da Máquina de Água (v11 - Sem MQTT) está no ar e operante.');
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

        const notificationId = req.query.id || req.body.data?.id; 

        if (!notificationId) {
            console.error('❌ Erro de Assinatura: ID da notificação ausente.');
            return res.sendStatus(400);
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
    
    // --- Processamento do Pagamento ---
    const notificacao = req.body;
    console.log('Conteúdo:', JSON.stringify(notificacao, null, 2));

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
                // mqttClient.publish(MQTT_TOPIC_COMANDO, "LIBERAR_AGUA", ...);
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
    console.log(`🚀 Servidor da máquina de águia (V11 - Sem MQTT) iniciado e rodando na porta ${PORT}`);
});