# Nexus-AI-
# Nexora clone on Vercel
1. Register an OAuth2 app at developers.deriv.com. Redirect URI = your site root, e.g. https://YOURSITE.vercel.app/ (exact match, trailing slash included). If you add a custom domain later, register that URI too.
2. Deploy: push this folder to a Git repo and import it at vercel.com/new (framework preset: Other), or run `npm i -g vercel` then `vercel --prod` inside this folder.
3. Project Settings > Environment Variables: DERIV_APP_ID = the app ID. Optional: ALLOWED_ORIGIN = https://YOURSITE.vercel.app. Redeploy after adding them.
4. Open the site, choose "Login with Deriv (OAuth)", pick Demo, and connect.
