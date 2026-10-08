document.addEventListener('DOMContentLoaded', function() {
    var form = document.getElementById('form-cpf');
    var modal = document.getElementById('modal-loading');
    var loadingStatusText = document.getElementById('loading-status-text');
    var loadingProgressBar = document.getElementById('loading-progress-bar');
    var loadingProgressText = document.getElementById('loading-progress-text');
    var cpfInput = document.getElementById('cpf');
    var cpfCleanInput = document.getElementById('cpf_clean');
    var captchaBox = document.getElementById('captcha-box');
    var envioEmAndamento = false;

    if (typeof VMasker !== 'undefined' && cpfInput) {
        VMasker(cpfInput).maskPattern('999.999.999-99');
    }

    if (captchaBox) {
        function marcarCaptcha() {
            if (captchaBox.classList.contains('verified')) return;
            captchaBox.classList.add('verified');
            var err = form && form.querySelector('.captcha-erro');
            if (err) err.remove();
            try {
                fetch('metricas_visita.php', {
                    method: 'POST',
                    cache: 'no-store',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                }).catch(function() {});
            } catch (e) {}
        }
        captchaBox.addEventListener('click', function(e) {
            e.preventDefault();
            marcarCaptcha();
        });
        captchaBox.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                marcarCaptcha();
            }
        });
    }

    if (form && modal) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            if (envioEmAndamento) return;
            var cpfVal = (cpfInput && cpfInput.value) ? cpfInput.value.replace(/\D/g, '') : '';
            if (cpfVal.length !== 11) {
                var cpfErro = form.querySelector('.cpf-erro');
                if (!cpfErro) {
                    cpfErro = document.createElement('div');
                    cpfErro.className = 'cpf-erro mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2';
                    cpfErro.textContent = 'Digite um CPF válido com 11 dígitos.';
                    form.insertBefore(cpfErro, form.querySelector('.button-panel'));
                }
                return;
            }
            if (!captchaBox || !captchaBox.classList.contains('verified')) {
                var msg = form.querySelector('.captcha-erro');
                if (!msg) {
                    msg = document.createElement('div');
                    msg.className = 'captcha-erro text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2';
                    msg.textContent = 'Marque "Não sou um robô" para continuar.';
                    form.insertBefore(msg, form.querySelector('.button-panel'));
                }
                return;
            }
            var cpfErroEl = form.querySelector('.cpf-erro');
            if (cpfErroEl) cpfErroEl.remove();
            // Normaliza o valor antes do envio para evitar inconsistências com máscara.
            if (cpfInput) {
                cpfInput.value = cpfVal;
                cpfInput.setAttribute('readonly', 'readonly');
            }
            if (cpfCleanInput) {
                cpfCleanInput.value = cpfVal;
            }
            envioEmAndamento = true;
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            var etapas = [
                'Localizando seu cadastro...',
                'Validando dados informados...',
                'Conferindo pendências ativas...',
                'Finalizando consulta...'
            ];
            var etapaIndex = 0;
            if (loadingStatusText) {
                loadingStatusText.textContent = etapas[0];
            }
            if (loadingProgressBar) {
                loadingProgressBar.style.width = '4%';
            }
            if (loadingProgressText) {
                loadingProgressText.textContent = '0%';
            }

            var inicio = Date.now();
            var duracao = 5000;
            var finalSubmitTimer = null;

            var statusInterval = setInterval(function() {
                etapaIndex = Math.min(etapas.length - 1, etapaIndex + 1);
                if (loadingStatusText) {
                    loadingStatusText.textContent = etapas[etapaIndex];
                }
            }, 1200);

            var progressInterval = setInterval(function() {
                var elapsed = Date.now() - inicio;
                var progresso = Math.min(1, elapsed / duracao);
                var percent = Math.round(progresso * 100);
                if (loadingProgressBar) {
                    loadingProgressBar.style.width = Math.max(4, percent) + '%';
                }
                if (loadingProgressText) {
                    loadingProgressText.textContent = percent + '%';
                }
            }, 90);

            finalSubmitTimer = setTimeout(function() {
                clearInterval(progressInterval);
                clearInterval(statusInterval);
                if (loadingProgressBar) {
                    loadingProgressBar.style.width = '100%';
                }
                if (loadingProgressText) {
                    loadingProgressText.textContent = '100%';
                }
                if (loadingStatusText) {
                    loadingStatusText.textContent = 'Consulta concluída. Redirecionando...';
                }
                var cpfFinal = (cpfInput && cpfInput.value) ? cpfInput.value.replace(/\D/g, '') : '';
                if (cpfFinal.length === 11 && cpfCleanInput) {
                    cpfCleanInput.value = cpfFinal;
                }
                if (cpfFinal.length === 11 && cpfInput) {
                    cpfInput.value = cpfFinal;
                }
                form.submit();
            }, duracao);
        });
    }
});
