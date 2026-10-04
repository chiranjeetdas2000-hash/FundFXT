(function(){
  'use strict';

  var API = 'https://fundfxt.onrender.com';
  var token = localStorage.getItem('tid_token');
  if(!token){ window.location.href = '/tradersid/login.html'; return; }

  function $(id){ return document.getElementById(id); }
  function toast(msg){
    var t = $('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(function(){ t.classList.remove('show'); }, 2800);
  }

  var ID_TYPES_BY_COUNTRY = {
    India: ['Aadhaar','PAN','Passport','Driving Licence','Voter ID'],
    UK: ['Passport','Driving Licence','BRP'],
    USA: ['Passport',"Driver's License",'State ID','SSN Card'],
    UAE: ['Passport','Emirates ID','Driving Licence'],
    Singapore: ['Passport','NRIC','Driving Licence'],
    Australia: ['Passport','Driving Licence','Medicare Card'],
    Canada: ['Passport','Driving Licence','PR Card'],
    Germany: ['Passport','National ID','Driving Licence'],
    France: ['Passport','National ID','Driving Licence'],
    Other: ['Passport','National ID','Driving Licence']
  };

  var countryEl = $('kycCountry');
  var idTypeEl = $('kycIdType');
  var addressTypeEl = $('kycAddressType');
  var idFileEl = $('kycIdFile');
  var selfieFileEl = $('kycSelfieFile');
  var addressFileEl = $('kycAddressFile');
  var idTextEl = $('kycIdText');
  var selfieTextEl = $('kycSelfieText');
  var addressTextEl = $('kycAddressText');
  var idPrevEl = $('kycIdPreview');
  var selfiePrevEl = $('kycSelfiePreview');
  var addressPrevEl = $('kycAddressPreview');
  var form = $('kycForm');
  var submitBtn = $('kycSubmit');
  var errBox = $('kycError');
  var statusCard = $('kycStatusCard');
  var statusTitle = $('kycStatusTitle');
  var statusText = $('kycStatusText');

  function setError(msg){
    if(!errBox) return;
    if(msg){ errBox.textContent = msg; errBox.classList.add('show'); }
    else { errBox.textContent = ''; errBox.classList.remove('show'); }
  }

  function populateIdTypes(){
    var country = countryEl ? countryEl.value : '';
    if(!idTypeEl) return;
    if(!country){
      idTypeEl.innerHTML = '<option value="">Select country first…</option>';
      return;
    }
    var types = ID_TYPES_BY_COUNTRY[country] || ID_TYPES_BY_COUNTRY.Other;
    idTypeEl.innerHTML = '<option value="">Select document type…</option>' +
      types.map(function(t){ return '<option value="' + t + '">' + t + '</option>'; }).join('');
  }

  if(countryEl) countryEl.addEventListener('change', populateIdTypes);

  function fmtBytes(b){
    var n = Number(b || 0);
    if(n < 1024) return n + ' B';
    if(n < 1024 * 1024) return (n/1024).toFixed(0) + ' KB';
    return (n/(1024*1024)).toFixed(1) + ' MB';
  }

  function wireFile(inputEl, textEl, previewEl){
    if(!inputEl) return;
    inputEl.addEventListener('change', function(){
      var f = this.files && this.files[0];
      if(!f){ if(textEl) textEl.textContent = 'Tap to select file'; if(previewEl) previewEl.classList.remove('show'); return; }
      if(f.size > 3 * 1024 * 1024){
        toast('File too large. Max 3 MB.');
        this.value = '';
        if(textEl) textEl.textContent = 'Tap to select file';
        if(previewEl) previewEl.classList.remove('show');
        return;
      }
      if(textEl) textEl.textContent = f.name.length > 32 ? f.name.slice(0, 30) + '…' : f.name;
      if(previewEl){
        previewEl.textContent = '✓ ' + f.name + ' · ' + fmtBytes(f.size);
        previewEl.classList.add('show');
      }
    });
  }
  wireFile(idFileEl, idTextEl, idPrevEl);
  wireFile(selfieFileEl, selfieTextEl, selfiePrevEl);
  wireFile(addressFileEl, addressTextEl, addressPrevEl);

  function getDeviceFingerprint(){
    try {
      var parts = [
        navigator.userAgent || '',
        navigator.language || '',
        screen.width + 'x' + screen.height,
        screen.colorDepth || '',
        new Date().getTimezoneOffset()
      ];
      var str = parts.join('|');
      var hash = 0;
      for(var i = 0; i < str.length; i++){
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
      }
      return 'fp_' + Math.abs(hash).toString(36) + '_' + str.length;
    } catch(_){ return null; }
  }

  function getTimezone(){
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
    catch(_){ return null; }
  }

  async function uploadFile(file, fileType, accountId){
    var fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', fileType);
    if(accountId) fd.append('account_id', String(accountId));
    var res = await fetch(API + '/api/tid/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    var data = await res.json();
    if(!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
    return data.file_id;
  }

  function showStatus(status, notes){
    if(!statusCard) return;
    statusCard.classList.remove('approved','pending','rejected');
    if(status === 'APPROVED'){
      statusCard.classList.add('show','approved');
      statusTitle.textContent = '✓ KYC Verified';
      statusText.textContent = 'Your identity is verified. Verified badge is now active on your Trader ID.';
    } else if(status === 'PENDING'){
      statusCard.classList.add('show','pending');
      statusTitle.textContent = '⏳ Verification Pending';
      statusText.textContent = 'Your documents are under review. This usually takes 24-72 hours. You will see the update on your dashboard.';
    } else if(status === 'REJECTED'){
      statusCard.classList.add('show','rejected');
      statusTitle.textContent = 'Verification Rejected';
      statusText.textContent = (notes ? 'Reason: ' + notes + ' ' : '') + 'Please re-submit with correct documents.';
    }
  }

  async function loadKycStatus(){
    try {
      var res = await fetch(API + '/api/tid/kyc/status', { headers: { Authorization: 'Bearer ' + token } });
      var data = await res.json();
      if(data.success && data.submitted && data.kyc){
        showStatus(data.kyc.status, data.kyc.admin_notes);
        if(data.kyc.status === 'APPROVED' && submitBtn){
          submitBtn.disabled = true;
          submitBtn.textContent = 'Already Verified';
        }
      }
    } catch(_){}
  }
  loadKycStatus();

  if(form) form.addEventListener('submit', async function(e){
    e.preventDefault();
    setError('');

    var country = countryEl.value;
    var idType = idTypeEl.value;
    var addressType = addressTypeEl.value;

    if(!country){ setError('Please select your country.'); return; }
    if(!idType){ setError('Please select identity document type.'); return; }
    if(!addressType){ setError('Please select address proof type.'); return; }
    if(!idFileEl.files[0]){ setError('Please upload your identity document.'); return; }
    if(!selfieFileEl.files[0]){ setError('Please take a selfie with your ID.'); return; }
    if(!addressFileEl.files[0]){ setError('Please upload your address proof.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading documents…';

    try {
      var idFileId = await uploadFile(idFileEl.files[0], 'ID_PROOF');
      submitBtn.textContent = 'Uploading selfie…';
      var selfieFileId = await uploadFile(selfieFileEl.files[0], 'SELFIE');
      submitBtn.textContent = 'Uploading address proof…';
      var addressFileId = await uploadFile(addressFileEl.files[0], 'ADDRESS_PROOF');

      submitBtn.textContent = 'Submitting…';

      var res = await fetch(API + '/api/tid/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          country: country,
          id_type: idType,
          address_type: addressType,
          id_file_id: idFileId,
          selfie_file_id: selfieFileId,
          address_file_id: addressFileId,
          device_fingerprint: getDeviceFingerprint(),
          timezone: getTimezone()
        })
      });
      var data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || 'Submission failed');

      toast('KYC submitted successfully');
      showStatus('PENDING');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(err){
      setError(err.message || 'Submission failed. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit for Review';
    }
  });

})();