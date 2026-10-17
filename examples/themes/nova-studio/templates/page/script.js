function render(){document.getElementById('site').textContent=NOVA.settings.name;document.getElementById('title').textContent=NOVA.context.page.title;document.getElementById('content').textContent=NOVA.context.page.content}
render();addEventListener('nova:context',render);
