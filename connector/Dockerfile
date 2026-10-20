FROM oven/bun:1.3.9
WORKDIR /app
COPY --chown=root:root connector/meross.ts connector/index.ts connector/cloud.ts connector/hourly.ts connector/discover.ts ./
RUN chmod -R a-w /app
USER bun
EXPOSE 3070
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3070) +'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "--env-file=/run/secrets/meross.env", "index.ts"]
