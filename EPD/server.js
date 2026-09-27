const express = require('express');         
const app = express();                                                                                 
const PORT = 3009;                                                                                   
                                                                                                        
app.use(express.json());                    
app.use(express.static(__dirname, { extensions: ['html'] }));                                          

app.use((req, res, next) => {                                                                          
  const knownPaths = new Set(['/buy', '/payment', '/payment_page','/track']);                                                                                            
  const base = req.path.replace(/\.(html|js|css|jpeg|png|ico)$/, '').replace(/\/$/, '') || '/';
                                                                                                        
  if (req.method === 'GET' && !knownPaths.has(base)) {                                                 
    console.log(`example.com.agent_nav: ${req.path} at ${Date.now()}`);                                                                                    
  }                                                                                                    
  next();                                                                                              
}); 

const store = {}; 
let lastClickTime=null;                                                                                     
                                            
app.post('/track', (req, res) => {                                                                     
  const { event, time } = req.body; 
    
  if (event=== 'button_click'){
    if (lastClickTime!==null){
      const interval = ((time - lastClickTime) / 1000).toFixed(2);
      console.log(`example.com.button_click: re-clicked after ${interval}s`);
    }
    lastClickTime = time;
    store[event] = store[event]||time;
    return res.sendStatus(200);
  }
  store[event] = time;                                                                  
  if (store.button_click && store.fingerprint) {                                                               
    const interval = ((store.fingerprint - store.button_click) / 1000).toFixed(2);                           
    console.log(`example.com.payment_page: ${interval}s`); 
    lastClickTime=null;                                            
    delete store.button_click;                                                                             
    delete store.fingerprint;               
  } 
  
  // if (store.loading && store.fingerprint) {                                                               
  //   const interval = ((store.fingerprint - store.loading) / 1000).toFixed(2);                           
  //   console.log(`example.com.payment_page: ${interval}s`);                                             
  //   delete store.loading;                                                                             
  //   delete store.fingerprint;               
  // } 
                                                                                                        
  res.sendStatus(200);                                                                               
});                                                                                                    
                                                                                                        
app.listen(PORT, '127.0.0.1', () => {                                                                
  console.log(`example.com server running on http://127.0.0.1:${PORT}`);                                 
}); 