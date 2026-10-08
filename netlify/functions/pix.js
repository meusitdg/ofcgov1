const { executar, carregarHandler } = require('./shared/adaptar');
const handler = carregarHandler(require('../../api/vizzionpay/pix.js'));

exports.handler = async (event) => executar(event, handler);
