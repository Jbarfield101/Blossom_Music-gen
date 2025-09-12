(function(){
  const list = document.getElementById('models');
  if(!list) return;
  fetch('/models', {headers: {'Accept': 'application/json'}})
    .then(r => r.json())
    .then(models => {
      models.forEach(m => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = m.url;
        a.textContent = m.name;
        li.appendChild(a);
        list.appendChild(li);
      });
    })
    .catch(err => {
      console.error(err);
    });
})();
