const express = require('express');
const bodyParser = require('body-parser');
// 1. MUDANÇA: Importamos as classes específicas da nova biblioteca
const { MercadoPagoConfig, Payment } = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================
// ⚠️ ATENÇÃO: PREENCHA SUAS CREDENCIAIS CORRETAMENTE ⚠️
// =================================================================

// --- CREDENCIAIS DO MERCADO PAGO ---
const MP_ACCESS_TOKEN = 'APP_USR-2337638380276117-092714-fcb4c7f0435c786f6c58a959e3dac448-1036328569';



// --- CREDENCIAIS DO MQTT ---
// (Corrigidas com base no seu código do ESP32)
const MQTT_BROKER_URL = 'mqtts://d848ae40758c4732b9333f823b832326.s1.eu.hivemq.cloud:8883'; // 👈 Note o "mqtts://" (com S) e a porta
const MQTT_USERNAME = 'watervendor01';
const MQTT_PASSWORD = 'Water2025';

// --- TÓPICO MQTT ------
// (Corrigido para o tópico exato que o seu ESP32 está escutando)
const MQTT_TOPIC_COMANDO = 'watervendor/maquina01/comandos';



// =================================================================
// FIM DAS CONFIGURAÇÕES..
// =================================================================

// 2. MUDANÇA: Nova forma de configurar o cliente
console.log('🔌 Configurando cliente Mercado Pago (SDK v3)...');
const client = new MercadoPagoConfig({
    accessToken: MP_ACCESS_TOKEN
});

// Criamos uma instância de Pagamento com o cliente
const payment = new Payment(client);


// --- Configuração do Cliente MQTT ---
console.log('🔌 Tentando conectar ao Broker MQTT...');
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: 'servidor_watervendor_UNILEVE'
});

mqttClient.on('connect', () => {
    console.log('✅ Conectado ao Broker MQTT com sucesso.');
});

mqttClient.on('error', (err) => {
    console.error('❌ Erro na conexão MQTT:', err);
});
// --- NOVO LOG DE DEPURAÇÃO ---
mqttClient.on('reconnect', () => {
    console.log('🔄 Tentando reconectar ao MQTT...');
});

// --- NOVO LOG DE DEPURAÇÃO ---
mqttClient.on('close', () => {
    console.log('🚪 Conexão MQTT fechada (evento "close").');
});

// --- NOVO LOG DE DEPURAÇÃO ---
mqttClient.on('offline', () => {
    console.log('🌐 Cliente MQTT ficou offline (evento "offline").');
});

// --- NOVO LOG DE DEPURAÇÃO ---
mqttClient.on('end', () => {
    console.log('🔚 Conexão MQTT terminada (evento "end").');
});
// --- Middlewares ---
app.use(bodyParser.json());

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    res.send('Servidor da Máquina de Água (v3.0 com logs) está no ar e operante.');
});


// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA ---');
    console.log('Conteúdo:', JSON.stringify(req.body, null, 2));

    const notificacao = req.body;

    if (notificacao.topic === 'payment' || notificacao.type === 'payment') {
        
        const paymentId = notificacao.data?.id || notificacao.resource; 

        if (!paymentId) {
            console.warn('⚠️ Notificação de pagamento sem ID. Ignorando.');
            return res.sendStatus(200);
        }

        console.log(`🔎 Notificação de pagamento recebida. ID: ${paymentId}. Buscando detalhes na API do MP...`);

        try {
            // A API v3 espera que o ID seja um número.
            const numericPaymentId = Number(paymentId);
            if (isNaN(numericPaymentId)) {
                console.error(`❌ ID do pagamento não é um número: ${paymentId}`);
                return res.sendStatus(200); // Responde 200 pro MP não insistir
            }

            // 3. MUDANÇA: Nova forma de buscar o pagamento
            const paymentDetails = await payment.get({ id: numericPaymentId });

            if (!paymentDetails) {
                console.error(`❌ Falha grave ao buscar dados do pagamento ${paymentId} na API do MP. Resposta vazia.`);
                return res.sendStatus(500); 
            }
            
            // Os detalhes agora vêm direto no objeto, não em "payment.body"
            console.log(`ℹ️ DETALHES DO PAGAMENTO: ID: ${paymentDetails.id} | STATUS: ${paymentDetails.status} | TIPO: ${paymentDetails.payment_type_id}`);

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

            } else if (paymentDetails.status === 'in_process' || paymentDetails.status === 'pending') {
                console.log(`⏳ Pagamento ${paymentId} ainda está "${paymentDetails.status}". Aguardando notificação final.`);
            } else {
                console.log(`❌ Pagamento ${paymentId} foi "${paymentDetails.status}". Nenhuma ação necessária.`);
            }

        } catch (error) {
            console.error(`💥 Erro ao processar o pagamento ${paymentId}:`, error.message);
            console.error(error); // Log completo do erro
        }
    
    } else if (notificacao.topic === 'merchant_order') {
        console.log('ℹ️ Recebida notificação de "merchant_order". Ignorando (focando apenas em "payment").');
    } else {
        console.log(`⚠️ Recebido tópico desconhecido: "${notificacao.topic || notificacao.type}". Ignorando.`);
    }

    res.sendStatus(200);
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor da máquina de água iniciado e rodando na porta ${PORT}`);
});