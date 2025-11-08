// =================================================================
// ARQUIVO: index.js (V_SMART_PROXY)
// DESCRIÇÃO: Servidor principal com rota inteligente para QR Codes fixos.
// =================================================================

require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// --- CARREGANDO VARIÁVEIS DE AMBIENTE ---
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
// Tópico base: remove '/comandos' se existir, para flexibilidade
const MQTT_BASE_TOPIC = process.env.MQTT_TOPIC_COMANDO ? process.env.MQTT_TOPIC_COMANDO.replace(/\/comandos\/?$/, '') : 'watervendor/maquina01';
// URL pública do servidor (necessária para o webhook e para o redirecionamento)
// Se não estiver definida no Render, usa um valor padrão, mas o ideal é definir RENDER_EXTERNAL_URL no painel.
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://watervendor-server.onrender.com';

if (!MP_ACCESS_TOKEN || !MQTT_BROKER_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    console.error('❌ ERRO FATAL: Verifique as Variáveis de Ambiente no RENDER!');
}

// --- CONEXÃO MQTT ---
console.log(`🔌 Conectando ao Broker MQTT em ${MQTT_BROKER_URL} como ${MQTT_USERNAME}...`);
const client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: `server_${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    keepalive: 30
});

client.on('connect', () => console.log('✅ Servidor conectado ao Broker MQTT com sucesso!'));
client.on('error', (err) => console.error('❌ Erro de conexão com o Broker MQTT:', err.message));

app.use(express.json());

app.get('/', (req, res) => res.send('Servidor WaterVendor (V_SMART_PROXY) está no ar!'));

// =================================================================
// 🆕 ROTA INTELIGENTE PARA QR CODES FIXOS 🆕
// O cliente acessa: .../comprar/maquina01/20000
// =================================================================
app.get('/comprar/:maquinaid/:volume', async (req, res) => {
    const { maquinaid, volume } = req.params;
    const volumeInt = parseInt(volume, 10);

    if (!maquinaid || isNaN(volumeInt)) {
        return res.status(400).send('Link inválido. Use o formato: /comprar/maquinaID/volumeML');
    }

    // 1. Descobrir o PREÇO atual para este volume
    // O servidor procura uma variável de ambiente chamada "PRECO_20000", "PRECO_1000", etc.
    const precoVarName = `PRECO_${volumeInt}`;
    const precoAtual = process.env[precoVarName];

    if (!precoAtual) {
        console.error(`❌ Tentativa de compra para volume ${volumeInt}ml, mas a variável ${precoVarName} não está definida no Render.`);
        return res.status(404).send(`Produto de ${volumeInt}ml não está configurado para venda no momento.`);
    }

    const precoFloat = parseFloat(precoAtual);
    const tituloProduto = `Água Mineral ${volumeInt}ml`;
    const referenciaExterna = `${maquinaid}-${volumeInt}`; // Ex: maquina01-20000

    console.log(`🛒 Novo pedido iniciado: ${tituloProduto} na ${maquinaid} por R$ ${precoFloat.toFixed(2)}`);

    // 2. Criar a preferência no Mercado Pago "na hora"
    try {
        const preferenceData = {
            items: [
                {
                    title: tituloProduto,
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: precoFloat
                }
            ],
            external_reference: referenciaExterna,
            notification_url: `${SERVER_URL}/notificacao-mp`, // Usa a URL correta do nosso servidor para o webhook
            auto_return: "approved",
            back_urls: {
                // Você pode mudar isso para uma página de "Obrigado" personalizada no futuro
                success: "https://www.google.com",
                failure: "https://www.google.com",
                pending: "https://www.google.com"
            }
        };

        const response = await axios.post('https://api.mercadopago.com/checkout/preferences', preferenceData, {
            headers: {
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        // 3. Redirecionar o cliente para o pagamento no Mercado Pago
        const checkoutUrl = response.data.init_point;
        console.log(`➡ Redirecionando cliente para o Mercado Pago: ${checkoutUrl}`);
        res.redirect(checkoutUrl);

    } catch (error) {
        console.error('💥 Erro ao criar preferência no Mercado Pago:', error.response ? error.response.data : error.message);
        res.status(500).send('Desculpe, ocorreu um erro ao iniciar o pagamento. Tente novamente em instantes.');
    }
});

// --- ROTA DE WEBHOOK (MANTIDA IGUAL) ---
app.post('/notificacao-mp', async (req, res) => {
    res.status(200).send('OK'); // Responde rápido para o MP

    const notificacao = req.body;
    const { action, type, topic, data } = notificacao;

    if (action === 'payment.updated' || type === 'payment' || topic === 'pagamento' || type === 'topic_merchant_order_wh' || topic === 'pedido_do_comerciante') {
        let paymentId = data?.id || notificacao.id;
        if (!paymentId && notificacao.recurso) {
             paymentId = notificacao.recurso.split('/').pop();
        }

        if (paymentId && !isNaN(paymentId)) {
            console.log(`🔎 Verificando Pagamento ID: ${paymentId}...`);
            try {
                const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                    headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
                });
                const payment = response.data;

                if (payment.status === 'approved' && payment.external_reference) {
                    console.log(`✅ Pagamento ${paymentId} APROVADO! Ref: ${payment.external_reference}`);
                    const parts = payment.external_reference.split('-');
                    if (parts.length >= 2) {
                        const volume = parseInt(parts.pop(), 10);
                        const machineId = parts.join('-');
                        if (volume > 0 && machineId) {
                            const topicComando = `${MQTT_BASE_TOPIC}/comandos`;
                            const message = JSON.stringify({ msg: volume });
                            if (client.connected) {
                                client.publish(topicComando, message, { qos: 1 });
                                console.log(`💧 COMANDO ENVIADO: ${message} -> ${topicComando}`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('⚡ Erro ao consultar API do MP:', error.message);
            }
        }
    }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));