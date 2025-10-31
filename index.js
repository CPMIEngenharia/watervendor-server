// Deploy V8 - Corrigindo a lógica de Assinatura
const express = require('express');
const crypto = require('crypto');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// ⚠️ ATENÇÃO: PREENCHA O SEU ACCESS TOKEN DO MERCADO PAGO ⚠️
// =================================================================
const MP_ACCESS_TOKEN = 'APP_USR-2337638380276117-092714-fcb4c7f0435c786f6c58a959e3dac448-1036328569'; // 👈 ⚠️ PREENCHA AQUI!
const MP_WEBHOOK_SECRET = '4e923a13f3eefc2794f5486746713822aeb2894019373ab05813b11f0e5efefa';
const MQTT_BROKER_URL = 'mqtts://d848ae40758c4732b9333f823b832326.s1.eu.hivemq.cloud:8883';
const MQTT_USERNAME = 'servidor_nodejs';
const MQTT_PASSWORD = 'Water2025';
const MQTT_TOPIC_COMANDO = 'watervendor/maquina01/comandos';
// =================================================================

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('V8 - 🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({ access_token: MP_ACCESS_TOKEN });
const mpPayment = new mercadopago.Payment(mpClient);

// --- Configuração do Cliente MQTT ---
console.log('V8 - 🔌 Tentando conectar ao Broker MQTT...');
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: 'servidor_nodejs', // ID DEVE SER IGUAL AO NOVO USERNAME
    reconnectPeriod: 5000
});

// --- LOGS DE EVENTOS MQTT (PARA DEPURAÇÃO) ---
mqttClient.on('connect', () => console.log('✅ Conectado ao Broker MQTT com sucesso.'));
mqttClient.on('error', (err) => console.error('❌ Erro na conexão MQTT:', err));
mqttClient.on('reconnect', () => console.log('🔄 Tentando reconectar ao MQTT...'));
mqttClient.on('close', () => console.log('🚪 Conexão MQTT fechada (evento "close").'));
// --- FIM DOS LOGS MQTT ---

// --- Middlewares ---
// Adiciona o 'verify' para salvar o "rawBody"
// Precisamos do rawBody ANTES do json() para a Assinatura
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar.');
    res.send('Servidor da Máquina de Água (v8 - Assinatura Fix) está no ar.');
});

// --- HANDLER GET (PARA DEPURAÇÃO DO 404 DO MP) ---
app.get('/notificacao-mp', (req, res) => {
    console.warn('⚠️ AVISO: Recebida uma requisição GET na rota /notificacao-mp. Esta rota só aceita POST.');
    res.status(405).send('Method Not Allowed: Esta rota só aceita POST.');
});
// --- FIM DO HANDLER ---

// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA (POST) ---');
    
    // === INÍCIO DA VALIDAÇÃO DE ASSINATURA (Lógica Corrigida) ===
    try {
        const signatureHeader = req.headers['x-signature'];
        const requestId = req.headers['x-request-id'];
        
        if (!signatureHeader || !requestId) {
            console.error('❌ Erro de Assinatura: Cabeçalhos (x-signature, x-request-id) ausentes.');
            return res.sendStatus(400); // Bad Request
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
            // Se o ID for do body, precisamos ter certeza que o body foi parseado
            console.log("Corpo recebido:", JSON.stringify(req.body));
            return res.sendStatus(400);
        }

        const baseString = `id:${notificationId};request-id:${requestId};ts:${ts};`;

        const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET);
        hmac.update(baseString);
        const generatedHash = hmac.digest('hex');

        if (generatedHash !== receivedHash) {
            console.error('❌ ERRO DE ASSINATURA: Assinatura inválida! Webhook rejeitado.');
            console.log(`   > Base String usada: ${baseString}`);
            console.log(`   > Hash Recebido: ${receivedHash}`);
            console.log(`   > Hash Gerado:   ${generatedHash}`);
            return res.sendStatus(403); // Forbidden
        }

        console.log('✅ Assinatura de Webhook validada com sucesso.');

    } catch (error) {
        console.error('💥 Erro fatal durante a validação da assinatura:', error.message);
        console.error("Stack trace:", error.stack);
        return res.sendStatus(500);
    }
    // === FIM DA VALIDAÇÃO DE ASSINATURA ===
    
    // -----------------------------------------------------------------
    // (O código de processamento do pagamento começa aqui)
    // -----------------------------------------------------------------
    
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
    console.log(`🚀 Servidor da máquina de águia (V8) iniciado e rodando na porta ${PORT}`);
});