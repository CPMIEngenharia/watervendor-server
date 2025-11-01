// V10 - Versão para Railway (lendo variáveis de ambiente)
const express = require('express');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
// O Railway define a porta pela variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE 🔒
// (Não preencha nada aqui, vamos configurar isso no Railway)
// =================================================================

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO;

// =================================================================

// Verificação de inicialização (só para log)
if (!MP_ACCESS_TOKEN || !MP_WEBHOOK_SECRET || !MQTT_BROKER_URL) {
    console.error('❌ ERRO FATAL: Variáveis de ambiente (MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MQTT_BROKER_URL) não definidas.');
    // Não paramos o processo para o Render/Railway não entrar em loop de crash
}

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('V10 - 🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);


// --- Configuração do Cliente MQTT ---
console.log('V10 - 🔌 Tentando conectar ao Broker MQTT...');
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: MQTT_USERNAME, // A política do HiveMQ exige que o ID seja igual ao Username
    reconnectPeriod: 5000,
    keepalive: 30 // Mantém a conexão ativa
});

// --- LOGS DE EVENTOS MQTT (PARA DEPURAÇÃO) ---
mqttClient.on('connect', () => console.log('✅ Conectado ao Broker MQTT com sucesso.'));
mqttClient.on('error', (err) => console.error('❌ Erro na conexão MQTT:', err));
mqttClient.on('reconnect', () => console.log('🔄 Tentando reconectar ao MQTT...'));
mqttClient.on('close', () => console.log('🚪 Conexão MQTT fechada (evento "close").'));
// --- FIM DOS LOGS MQTT ---


// --- Middlewares ---
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar.');
    res.send('Servidor da Máquina de Água (v10 - Railway) está no ar e operante.');
});


// --- HANDLER GET (PARA DEPURAÇÃO DO 404 DO MP) ---
app.get('/notificacao-mp', (req, res) => {
    console.warn('⚠️ AVISO: Recebida uma requisição GET na rota /notificacao-mp. Esta rota só aceita POST.');
    res.status(405).send('Method Not Allowed: Esta rota só aceita POST.');
});
// --- FIM DO HANDLER ---


// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// (Lógica de assinatura v8)
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA (POST) ---');
    
    // === INÍCIO DA VALIDAÇÃO DE ASSINATURA ===
    try {
        const signatureHeader = req.headers['x-signature'];
        const requestId = req.headers['x-request-id'];
        
        if (!signatureHeader || !requestId) {
            console.error('❌ Erro de Assinatura: Cabeçalhos (x-signature, x-request-id) ausentes.');
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

        // A documentação do MP é confusa. O 'id' pode estar no 'query' ou no 'body.data.id'
        const notificationId = req.query.id || req.body.data?.id; 

        if (!notificationId) {
            console.error('❌ Erro de Assinatura: ID da notificação (query.id ou body.data.id) está ausente.');
            return res.sendStatus(400);
        }

        const baseString = `id:${notificationId};request-id:${requestId};ts:${ts};`;
        const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET);
        hmac.update(baseString);
        const generatedHash = hmac.digest('hex');

        if (generatedHash !== receivedHash) {
            console.error('❌ ERRO DE ASSINATURA: Assinatura inválida! Webhook rejeitado.');
            return res.sendStatus(403); // Forbidden
        }
        console.log('✅ Assinatura de Webhook validada com sucesso.');
    } catch (error) {
        console.error('💥 Erro fatal durante a validação da assinatura:', error.message);
        return res.sendStatus(500);
    }
    // === FIM DA VALIDAÇÃO DE ASSINATURA ===
    
    // (O resto do código de processamento de pagamento continua aqui, intacto)
    
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
            if (!paymentDetails) {
                console.error(`❌ Falha grave ao buscar dados do pagamento ${paymentId}.`);
                return res.sendStatus(500); 
            }
            
            console.log(`ℹ️ DETALHES DO PAGAMENTO: ID: ${paymentId} | STATUS: ${paymentDetails.status} | TIPO: ${paymentDetails.payment_type_id}`);
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
                console.log(`⏳ Pagamento ${paymentId} ainda está "${paymentDetails.status}". Aguardando notificação.`);
            }
        } catch (error) {
            console.error(`💥 Erro ao processar o pagamento ${paymentId}:`, error.message);
        }
    } else {
        console.log(`ℹ️ Recebido evento do tipo "${notificacao.type}". Ignorando (focando apenas em "payment").`);
    }

    res.sendStatus(200); // Responde 200 (OK) para o MP
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor da máquina de águia (V10) iniciado e rodando na porta ${PORT}`);
});