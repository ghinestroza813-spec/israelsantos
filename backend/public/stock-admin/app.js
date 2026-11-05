"use strict";
const $=id=>document.getElementById(id);
let cfg=null,token=null,admin=null,variants=[];
function notice(message){$("notice").textContent=message}
function td(row,value){const cell=document.createElement("td");cell.textContent=value==null?"—":String(value);row.append(cell)}
async function api(route,options={}){const headers={"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})};const response=await fetch(route,{...options,headers:{...headers,...options.headers}});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"Erro HTTP "+response.status);return data}
async function loadConfig(){cfg=await api("/api/admin-auth-config")}
async function login(email,password){if(!cfg)await loadConfig();const response=await fetch(cfg.supabaseUrl+"/auth/v1/token?grant_type=password",{method:"POST",headers:{"Content-Type":"application/json",apikey:cfg.anonKey},body:JSON.stringify({email,password})});const data=await response.json();if(!response.ok||!data.access_token)throw Error("Credenciais inválidas ou acesso indisponível.");token=data.access_token;try{const result=await api("/api/admin/me");admin=result.admin;await loadProducts();$("loginSection").hidden=true;$("console").hidden=false;$("logout").hidden=false;$("movementSection").hidden=admin.role!=="admin";notice("Sessão iniciada. Selecione um produto.")}catch(error){token=null;admin=null;throw error}}
async function loadProducts(){const data=await api("/api/admin/products");const select=$("products");select.replaceChildren(new Option("Selecione...",""));for(const product of data.products||[])select.add(new Option(product.name+" · "+(product.sku||"sem SKU"),product.id))}
async function loadProduct(){const id=$("products").value;$("variants").replaceChildren();$("history").replaceChildren();$("variant").replaceChildren();variants=[];$("legacy").textContent="";if(!id)return;const [v,m]=await Promise.all([api("/api/admin/products/"+encodeURIComponent(id)+"/variants"),api("/api/admin/products/"+encodeURIComponent(id)+"/inventory-movements")]);variants=v.variants||[];$("legacy").textContent="Estoque original não distribuído: "+(v.legacy_stock_unallocated??"não informado")+" · Total por variações: "+variants.reduce((sum,x)=>sum+x.stock,0);for(const x of variants){const row=document.createElement("tr");td(row,[x.size,x.color,x.label].filter(Boolean).join(" / "));td(row,x.sku);td(row,x.stock-x.reserved_quantity);td(row,x.reserved_quantity);$("variants").append(row);$("variant").add(new Option([x.size,x.color,x.label].filter(Boolean).join(" / ")+" · "+(x.sku||"sem SKU"),x.id))}for(const x of m.movements||[]){const row=document.createElement("tr");td(row,new Date(x.created_at).toLocaleString("pt-BR"));td(row,x.movement_type);td(row,x.quantity_delta);td(row,x.stock_before+" → "+x.stock_after);td(row,x.reason);$("history").append(row)}}
$("login").addEventListener("submit",async e=>{e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;try{await login($("email").value,$("password").value);$("password").value=""}catch(error){notice(error.message)}finally{button.disabled=false}});
$("logout").addEventListener("click",()=>{token=null;admin=null;variants=[];$("console").hidden=true;$("loginSection").hidden=false;$("logout").hidden=true;notice("Sessão encerrada.")});
$("products").addEventListener("change",async()=>{try{await loadProduct();notice("")}catch(error){notice(error.message)}});
$("movement").addEventListener("submit",async e=>{e.preventDefault();if(!admin||admin.role!=="admin")return;const quantity=Number($("quantity").value),type=$("type").value;if(!Number.isSafeInteger(quantity)||quantity===0){notice("Informe uma quantidade inteira diferente de zero.");return}if((["purchase","return"].includes(type)&&quantity<0)||(["sale","loss"].includes(type)&&quantity>0)){notice("O sinal da quantidade não corresponde ao tipo.");return}const selected=$("variant").value;if(!variants.some(v=>v.id===selected)){notice("Selecione uma variação válida.");return}if(!confirm("Confirmar movimentação de "+quantity+" unidade(s)?"))return;const button=$("submitMovement");button.disabled=true;try{await api("/api/admin/variants/"+encodeURIComponent(selected)+"/movements",{method:"POST",body:JSON.stringify({movement_type:type,quantity_delta:quantity,reason:$("reason").value,reference:$("reference").value||null,idempotency_key:crypto.randomUUID()})});await loadProduct();$("quantity").value="";$("reason").value="";$("reference").value="";notice("Movimentação registrada com sucesso.")}catch(error){notice(error.message)}finally{button.disabled=false}});

// Supabase sends a short-lived recovery session in the URL fragment.
// Remove it immediately from browser history after reading it.
let recoveryToken=null;
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.get("type")==="recovery"&&fragment.get("access_token")){
  recoveryToken=fragment.get("access_token");
  history.replaceState(null,"",location.pathname+location.search);
  $("login").hidden=true;
  $("forgotPassword").hidden=true;
  $("resetPassword").hidden=false;
  notice("Defina uma nova senha para sua conta.");
}else if(fragment.get("error")||fragment.get("error_description")){
  history.replaceState(null,"",location.pathname+location.search);
  notice("Link de recuperação inválido ou expirado. Solicite outro.");
}
$("forgotPassword").addEventListener("click",()=>{
  $("recoveryRequest").hidden=false;
  $("recoveryEmail").value=$("email").value;
  notice("");
});
$("cancelRecovery").addEventListener("click",()=>{
  $("recoveryRequest").hidden=true;
  notice("");
});
$("recoveryRequest").addEventListener("submit",async e=>{
  e.preventDefault();
  const button=e.target.querySelector('button[type="submit"]');
  button.disabled=true;
  try{
    if(!cfg)await loadConfig();
    const redirect=location.origin+"/stock-admin/";
    const response=await fetch(cfg.supabaseUrl+"/auth/v1/recover?redirect_to="+encodeURIComponent(redirect),{
      method:"POST",
      headers:{"Content-Type":"application/json",apikey:cfg.anonKey},
      body:JSON.stringify({email:$("recoveryEmail").value.trim()})
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw Error(data.msg||data.error_description||data.message||"Não foi possível solicitar a recuperação.");
    }
    $("recoveryRequest").hidden=true;
    notice("Se o e-mail estiver cadastrado, você receberá um link de recuperação. Verifique também a caixa de spam.");
  }catch(error){notice(error.message)}finally{button.disabled=false}
});
$("resetPassword").addEventListener("submit",async e=>{
  e.preventDefault();
  const password=$("newPassword").value;
  if(password!==$("confirmPassword").value){notice("As senhas não coincidem.");return}
  if(password.length<8){notice("A senha deve ter pelo menos 8 caracteres.");return}
  const button=e.target.querySelector("button");
  button.disabled=true;
  try{
    if(!cfg)await loadConfig();
    if(!recoveryToken)throw Error("Link expirado. Solicite uma nova recuperação.");
    const response=await fetch(cfg.supabaseUrl+"/auth/v1/user",{
      method:"PUT",
      headers:{"Content-Type":"application/json",apikey:cfg.anonKey,Authorization:"Bearer "+recoveryToken},
      body:JSON.stringify({password})
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw Error(data.msg||data.error_description||data.message||"Não foi possível alterar a senha.");
    }
    recoveryToken=null;
    $("newPassword").value="";
    $("confirmPassword").value="";
    $("resetPassword").hidden=true;
    $("login").hidden=false;
    $("forgotPassword").hidden=false;
    notice("Senha atualizada. Entre com sua nova senha.");
  }catch(error){notice(error.message)}finally{button.disabled=false}
});
loadConfig().catch(error=>notice("Configuração pendente: "+error.message));
