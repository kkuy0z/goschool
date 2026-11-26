(() => {
  'use strict';

  const form = document.getElementById('enrollment-form');
  const status = document.getElementById('status');
  const role = document.getElementById('tipo');
  const guardianFields = document.getElementById('guardian-fields');
  const guardianName = document.getElementById('responsavelNome');
  const guardianRelation = document.getElementById('responsavelVinculo');
  const consent = document.getElementById('consentimento');
  const submitButton = document.getElementById('submit-button');

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.setAttribute('role', isError ? 'alert' : 'status');
  }

  function updateGuardianFields() {
    const isStudent = role.value === 'aluno';
    guardianFields.hidden = !isStudent;
    guardianName.required = isStudent;
    guardianRelation.required = isStudent;
    consent.required = isStudent;
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

  role.addEventListener('change', updateGuardianFields);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const payload = {
      nome: document.getElementById('nome').value.trim(),
      email: document.getElementById('email').value.trim(),
      tipo: role.value,
      responsavelNome: guardianName.value.trim(),
      responsavelVinculo: guardianRelation.value.trim(),
      consentimento: consent.checked
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
      if (!response.ok || !data.sucesso) throw new Error(data.erro || 'Não foi possível cadastrar o usuário.');
      form.reset();
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