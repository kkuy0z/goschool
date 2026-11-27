(() => {
  'use strict';

  const form = document.getElementById('enrollment-form');
  const status = document.getElementById('status');
  const fullName = document.getElementById('nome');
  const emailInput = document.getElementById('email');
  const role = document.getElementById('tipo');
  const guardianFields = document.getElementById('guardian-fields');
  const guardianName = document.getElementById('responsavelNome');
  const guardianRelation = document.getElementById('responsavelVinculo');
  const consent = document.getElementById('consentimento');
  const submitButton = document.getElementById('submit-button');

  const TEXT_ONLY_REGEX = /^[\p{L}\s'-]+$/u;
  const STRIP_NON_TEXT = /[^\p{L}\s'-]+/gu;
  const textOnlyFields = [fullName, guardianName, guardianRelation].filter(Boolean);

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.setAttribute('role', isError ? 'alert' : 'status');
  }

  function sanitizeTextField(input, showBlockedMessage = false) {
    const cleaned = input.value.replace(STRIP_NON_TEXT, '');
    const hadBlockedChars = input.value !== cleaned;

    if (hadBlockedChars) {
      input.value = cleaned;
    }

    const normalized = input.value.trim().replace(/\s+/g, ' ');
    if (normalized && !TEXT_ONLY_REGEX.test(normalized)) {
      input.setCustomValidity('Use apenas letras, espaços, hífen ou apóstrofo.');
    } else {
      input.setCustomValidity('');
    }

    if (hadBlockedChars && showBlockedMessage) {
      showStatus('Números e símbolos inválidos não são permitidos nesse campo.', true);
    }
  }

  function updateGuardianFields() {
    const isStudent = role.value === 'aluno';
    guardianFields.hidden = !isStudent;
    guardianName.required = isStudent;
    guardianRelation.required = isStudent;
    consent.required = isStudent;

    if (!isStudent) {
      guardianName.value = '';
      guardianRelation.value = '';
      consent.checked = false;
      guardianName.setCustomValidity('');
      guardianRelation.setCustomValidity('');
    }
  }

  async function checkCoordinator() {
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.sucesso || data.usuario?.tipo !== 'adm') {
        showStatus('Acesso restrito à Coordenação. Entre com uma conta administrativa.', true);
        form.hidden = true;
        return;
      }
      form.hidden = false;
    } catch {
      showStatus('Não foi possível verificar a sessão. Verifique se o GoSchool está em execução.', true);
      form.hidden = true;
    }
  }

  textOnlyFields.forEach((input) => {
    input.addEventListener('input', () => {
      sanitizeTextField(input, true);
    });

    input.addEventListener('blur', () => {
      input.value = input.value.trim().replace(/\s+/g, ' ');
      sanitizeTextField(input, false);
    });
  });

  role.addEventListener('change', updateGuardianFields);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    textOnlyFields.forEach((input) => {
      input.value = input.value.trim().replace(/\s+/g, ' ');
      sanitizeTextField(input, false);
    });

    if (!form.reportValidity()) return;

    const isStudent = role.value === 'aluno';
    const payload = {
      nome: fullName.value.trim(),
      email: emailInput.value.trim(),
      tipo: role.value,
      responsavelNome: isStudent ? guardianName.value.trim() : '',
      responsavelVinculo: isStudent ? guardianRelation.value.trim() : '',
      consentimento: isStudent ? consent.checked : false
    };

    submitButton.disabled = true;
    showStatus('Salvando cadastro…');
    try {
      const response = await fetch('/api/admin/usuarios', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.sucesso) {
        throw new Error(data.erro || 'Não foi possível cadastrar o usuário.');
      }
      form.reset();
      textOnlyFields.forEach((input) => input.setCustomValidity(''));
      updateGuardianFields();
      showStatus(data.mensagem || 'Cadastro concluído.');
    } catch (error) {
      showStatus(error.message || 'Falha de comunicação. Tente novamente.', true);
    } finally {
      submitButton.disabled = false;
    }
  });

  form.hidden = true;
  updateGuardianFields();
  checkCoordinator();
})();