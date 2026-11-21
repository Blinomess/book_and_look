pipeline {
  // Run on a dedicated Linux Jenkins agent with Node 22 and Docker Compose.
  agent { label 'docker' }
  options { timestamps(); disableConcurrentBuilds() }
  stages {
    stage('Install') { steps { sh 'npm ci' } }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Unit tests') { steps { sh 'npm test' } }
    stage('Integration tests') {
      steps { sh 'docker compose -p campus-ci -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests' }
      post { always { sh 'docker compose -p campus-ci -f compose.test.yaml down -v' } }
    }
    stage('Build image') { steps { sh 'docker build -t campus-booking:local .' } }
  }
}
