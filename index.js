// V14 - "Reset" Final com Verificação Completa de Variáveis
const express = require('express');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE 🔒
// =================================================================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO;
// =================================================================

// =================================================================
// 🪲 VERIFICAÇÃO DE ERRO (A CORREÇÃO) 🪲
// =================================================================
let hasError = false;
if (!MP_ACCESS_TOKEN) { console.error('❌ ERRO FATAL: Variável de ambiente MP_ACCESS_TOKEN não definida.'); hasError = true; }
if (!MP_WEBHOOK_SECRET) { console.error('❌ ERRO FATAL: Variável de ambiente MP_WEBHOOK_SECRET não definida.'); hasError = true; }
if (!MQTT_BROKER_URL) { console.error('❌ ERRO FATAL: Variável de ambiente MQTT_BROKER_URL não definida.'); hasError = true; }
if (!MQTT_USERNAME) { console.error('❌ ERRO FATAL: Variável de ambiente MQTT_USERNAME não definida.'); hasError = true; }
if (!MQTT_PASSWORD) { console.error('❌ ERRO FATAL: Variável de ambiente MQTT_PASSWORD não definida.'); hasError = true; }
if (!MQTT_TOPIC_COMANDO) { console.error('❌ ERRO FATAL: Variável de ambiente MQTT_TOPIC_COMANDO não definida.'); hasError = true; }
// =================================================================

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('V15 - 🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);

// --- Configuração do Cliente MQTT (SÓ CONECTA SE NÃO TIVER ERRO) ---
if (!hasError) {
    console.log('V15 - 🔌 Tentando conectar ao Broker MQTT...');
    const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        clientId: MQTT_USERNAME, // A política do HiveMQ exige que o ID seja igual ao Username
        reconnectPeriod: 5000,
        keepalive: 30
    });

    mqttClient.on('connect', () => console.log('✅ Conectado ao Broker MQTT com sucesso.'));
    mqttClient.on('error', (err) => console.error('❌ Erro na conexão MQTT:', err.message)); // Log mais limpo
    mqttClient.on('reconnect', () => console.log('🔄 Tentando reconectar ao MQTT...'));
    mqttClient.on('close', () => console.log('🚪 Conexão MQTT fechada (evento "close").'));
} else {
    console.error('MQTT desativado devido a erros fatais de variável.');
}

// --- Middlewares ---
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar (v14).');
    res.send('Servidor da Máquina de Água (v14 - Final Check) está no ar e operante.');
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
    if (hasError) {
        console.error('❌ Notificação recebida, mas o servidor está em modo de erro (Variáveis ausentes).');
        return res.sendStatus(500);
    }
    
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA (POST) ---');
    console.log('Conteúdo (Body) recebido:', JSON.stringify(req.body, null, 2));

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
        
        const notificationId = req.query['data.id'] || req.body.id; 

        if (!notificationId) {
            console.error('❌ Erro de Assinatura: ID da notificação (req.body.id) não encontrado.');
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

    if (notificacao.type === 'payment' || notificacao.topic === 'payment' || notificacao.action === 'payment.created') {
        const paymentId = notificacao.data?.id; 
        if (!paymentId) {
            console.warn('⚠️ Notificação de "payment" sem "data.id". Ignorando.');
            return res.sendStatus(200);
        }
        console.log(`🔎 Notificação de pagamento recebida. ID: ${paymentId}. Buscando detalhes...`);

        try {
            const paymentDetails = await mpPayment.get({ id: paymentId });
            if (paymentDetails.status === 'approved') {
                console.log('✅ PAGAMENTO APROVADO! Preparando para enviar comando MQTT...');
                const mensagemMQTT = 'LIBERAR_AGUA';
                
                mqttClient.publish(MQTT_TOPIC_COMANDO, mensagemMQTT, (err) => {
                    if (err) {
                        console.error('❌ Erro ao publicar mensagem no MQTT:', err);
                    } else {
                        console.log(`🚀 Comando "${mensagemMQTT}" publicado com sucesso no tópico "${MQTT_TOPIC_COMANDO}".`);
                    }
                });
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
    console.log(`🚀 Servidor da máquina de águia (V14 - FINAL CHECK) iniciado e rodando na porta ${PORT}`);
});